// T-41 (WP06 §11.4 "Launch kit builder") — one coherent batch (welcome / announcement / day-3 value
// email / day-7 event invite), generated in PARALLEL so the whole batch lands well inside the AC's
// "within 60 s of the new-member trigger" (§11.8-3) even though each piece independently runs the
// full regenerate-on-violation doctrine loop (content-generation.ts) before persisting through the
// SAME single gate every other WP06 surface uses (ContentItemService.createFromDraft — CFE + vocab).
//
// THE WHOLE-KIT HOLD (§11.4/§11.8-3): "If a kit component triggers a compliance block, the whole kit
// holds for human review." Each piece is independently CFE-cleared (own state on its own
// ContentItem row), but the moment ANY piece lands BLOCKED, the LaunchKit itself moves to
// HELD_FOR_REVIEW — never READY_FOR_REVIEW/APPROVED while a sibling piece is blocked.
//
// REAL-PHOTO RULE (§11.4/§11.8-10, critical-failure condition): `photoUrl` is the rep's/new member's
// REAL onboarding photo (`User.image`) — this service never fabricates or substitutes a stock image;
// when no photo was chosen (the SAME "no live upload pipeline, chosen just records the pick"
// constraint documented in src/app/onboarding/components/IdentityStep.tsx applies platform-wide —
// there is no photo asset store in this codebase beyond `User.image`), `photoUrl` is left null and
// the launch-kit UI renders the SAME initials-avatar fallback onboarding already uses — never a
// substituted stock photo.
//
// NEVER "RECRUIT": every ANNOUNCEMENT/WELCOME piece is additionally scanned by
// `doctrine-guard.ts#scanRecruitFraming` (narrower than the general vocabulary table's "recruit"
// verb rule — it catches the NOUN framing "our newest sign-up"/"new recruit").

import {
  buildLaunchKitPiecePrompt,
} from './prompt-library';
import {
  generateDoctrineCleanDraft,
  parseLaunchKitPieceResponse,
  type GeneratedDraft,
  type GenerationDeps,
} from './content-generation';
import { scanRecruitFraming } from './doctrine-guard';
import { ContentItemService, type ContentItemRow } from './content-item.service';
import type { ContentBriefService } from './content-brief.service';
import type { LaunchKitPieceType, LaunchKitState, LaunchKitVersion, WelcomeVariant } from '@prisma/client';

export interface LaunchKitRow {
  id: string;
  user_id: string;
  new_member_contact_id: string | null;
  new_member_first_name: string;
  welcome_variant: WelcomeVariant;
  version: LaunchKitVersion;
  state: LaunchKitState;
  photo_url: string | null;
  triggered_at: Date;
  generated_at: Date | null;
  held_reason: string | null;
  withdrawn_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface LaunchKitPrismaClient {
  launchKit: {
    create(args: { data: Record<string, unknown> }): Promise<LaunchKitRow>;
    findFirst(args: { where: { id: string; user_id: string } }): Promise<LaunchKitRow | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<LaunchKitRow[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<LaunchKitRow>;
  };
  contentItem: {
    findMany(args: { where: { launch_kit_id: string } }): Promise<ContentItemRow[]>;
    updateMany(args: { where: { launch_kit_id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

const ALL_PIECES: LaunchKitPieceType[] = ['WELCOME', 'ANNOUNCEMENT', 'DAY3_VALUE_EMAIL', 'DAY7_EVENT_INVITE'];

export interface TriggerKitInput {
  userId: string;
  newMemberContactId?: string | null;
  newMemberFirstName: string;
  welcomeVariant: WelcomeVariant;
  version?: LaunchKitVersion;
  photoUrl?: string | null;
}

export interface TriggerKitResult {
  kit: LaunchKitRow;
  items: ContentItemRow[];
  wholeKitHeld: boolean;
}

export class LaunchKitService {
  constructor(
    private prisma: LaunchKitPrismaClient,
    private briefService: ContentBriefService,
    private contentItemService: ContentItemService,
    private generation: GenerationDeps
  ) {}

  async triggerKit(input: TriggerKitInput, now: Date = new Date()): Promise<TriggerKitResult> {
    const identity = await this.briefService.loadRepIdentity(input.userId);

    const kit = await this.prisma.launchKit.create({
      data: {
        user_id: input.userId,
        new_member_contact_id: input.newMemberContactId ?? null,
        new_member_first_name: input.newMemberFirstName,
        welcome_variant: input.welcomeVariant,
        version: input.version ?? 'V1_STANDARD',
        state: 'DRAFTING',
        photo_url: input.photoUrl ?? null,
        triggered_at: now,
      },
    });

    // Generated IN PARALLEL (§11.8-3 "within 60 s") — each piece independently runs the full
    // regenerate-on-violation doctrine loop, so parallelizing is what keeps the whole batch fast.
    const drafts = await Promise.all(
      ALL_PIECES.map(async (piece) => {
        const prompt = buildLaunchKitPiecePrompt({
          piece,
          welcomeVariant: input.welcomeVariant,
          newMemberFirstName: input.newMemberFirstName,
          repFirstName: identity.firstName,
          anchorStatement: identity.anchorStatement,
        });
        const draft = await generateDoctrineCleanDraft(
          { systemPrompt: prompt.system, userPrompt: prompt.user, parse: parseLaunchKitPieceResponse },
          this.generation
        );
        return { piece, draft };
      })
    );

    const items: ContentItemRow[] = [];
    let anyBlocked = false;

    for (const { piece, draft } of drafts) {
      let vocabClean = draft.vocabClean;
      const doctrineNotes: string[] = Array.isArray(draft.doctrineNotes) ? [...draft.doctrineNotes] : [];

      // Launch-kit-specific "never a recruit/sign-up" guard on the two member-facing pieces.
      if (vocabClean && (piece === 'ANNOUNCEMENT' || piece === 'WELCOME')) {
        const recruitScan = scanRecruitFraming(draft.body);
        if (!recruitScan.clean) {
          vocabClean = false;
          doctrineNotes.push(...recruitScan.violations.map((v) => `recruit/sign-up framing: "${v.match}"`));
        }
      }

      const contentType = piece === 'DAY3_VALUE_EMAIL' || piece === 'DAY7_EVENT_INVITE' ? 'EMAIL' : 'SOCIAL_POST';
      const { item } = await this.contentItemService.createFromDraft({
        userId: input.userId,
        contentType,
        launchKitId: kit.id,
        launchKitPieceType: piece,
        headline: draft.headline ?? null,
        body: draft.body,
        imageConceptPrompt:
          piece === 'ANNOUNCEMENT'
            ? (input.photoUrl ?? "Use the new member's real onboarding photo — never a stock image.")
            : (draft.imageConceptPrompt ?? null),
        vocabClean,
        vocabViolations: vocabClean ? null : doctrineNotes,
        doctrineNotes,
        modelUsed: draft.modelId,
      });
      items.push(item);
      if (item.state === 'BLOCKED') anyBlocked = true;
    }

    const nextState: LaunchKitState = anyBlocked ? 'HELD_FOR_REVIEW' : 'READY_FOR_REVIEW';
    const updatedKit = await this.prisma.launchKit.update({
      where: { id: kit.id },
      data: {
        state: nextState,
        generated_at: now,
        held_reason: anyBlocked ? 'one_or_more_pieces_blocked_by_compliance_or_doctrine' : null,
      },
    });

    return { kit: updatedKit, items, wholeKitHeld: anyBlocked };
  }

  async getKit(userId: string, kitId: string): Promise<{ kit: LaunchKitRow; items: ContentItemRow[] } | null> {
    const kit = await this.prisma.launchKit.findFirst({ where: { id: kitId, user_id: userId } });
    if (!kit) return null;
    const items = await this.prisma.contentItem.findMany({ where: { launch_kit_id: kitId } });
    return { kit, items };
  }

  /** The rep's whole-kit sign-off — refused while any piece is still BLOCKED (the whole-kit hold). */
  async approveKit(userId: string, kitId: string): Promise<{ ok: true; kit: LaunchKitRow } | { ok: false; reason: 'not_found' | 'still_held' }> {
    const found = await this.getKit(userId, kitId);
    if (!found) return { ok: false, reason: 'not_found' };
    if (found.items.some((i) => i.state === 'BLOCKED')) {
      return { ok: false, reason: 'still_held' };
    }
    const kit = await this.prisma.launchKit.update({ where: { id: kitId }, data: { state: 'APPROVED' } });
    return { ok: true, kit };
  }

  /** §11.4 "if the new member withdraws, materials move to drafts" — the kit and every one of its
   *  pieces return to DRAFTING (never auto-published), and any pending schedule is cleared. */
  async withdrawKit(userId: string, kitId: string, now: Date = new Date()): Promise<{ ok: true; kit: LaunchKitRow } | { ok: false; reason: 'not_found' }> {
    const kit = await this.prisma.launchKit.findFirst({ where: { id: kitId, user_id: userId } });
    if (!kit) return { ok: false, reason: 'not_found' };

    await this.prisma.contentItem.updateMany({
      where: { launch_kit_id: kitId },
      data: { state: 'DRAFTING', scheduled_for: null, approved_by: null, approved_at: null },
    });
    const updated = await this.prisma.launchKit.update({
      where: { id: kitId },
      data: { state: 'WITHDRAWN_TO_DRAFTS', withdrawn_at: now },
    });
    return { ok: true, kit: updated };
  }
}

export type { GeneratedDraft };
