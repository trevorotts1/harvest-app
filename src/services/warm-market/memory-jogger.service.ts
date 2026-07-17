// T-23 (§7.4 Memory Jogger; §16.4/§7.1 PII encrypted at rest).
//
// DECRYPT FIX (HARD REQUIREMENT): `Contact.first_name`/`last_name`/`phone`/`email`/`notes` became
// AES-256-GCM ciphertext at rest as of T-22 (the Vault). `generatePrompts` below used to interpolate
// `contact.first_name` directly into rep-facing prompt text — after T-22 that is the raw ciphertext
// envelope (a JSON blob), not a name. Every PII read in this file now goes through
// `decryptContactPII` (src/services/warm-market/vault/vault-encryption.ts), the same helper
// `src/app/api/contacts/import/route.ts`'s GET handler already uses for the Vault list view.

import { PrismaClient } from '@prisma/client';

import { findForbiddenTerms } from '../../types/onboarding';
import { ContactSource } from '../../types/warm-market';
import {
  decryptContactPII,
  encryptRequiredField,
  getContactEncryptionKey,
} from './vault/vault-encryption';
import type { MemoryJoggerCategoryClient } from './memory-jogger/category-client';
import { LocalDeterministicMemoryJoggerCategoryClient } from './memory-jogger/local-category-client';
import {
  MemoryJoggerCategory,
  MemoryJoggerCategoryPrompt,
  shouldTriggerMemoryJogger,
} from './memory-jogger/types';

/** §0.5 defensive re-check on generated/surfaced Memory Jogger text — mirrors
 * `SevenWhysAnchorVocabViolationError` (WP01 §6.4, ../onboarding/wp01/seven-whys/anchor.ts). Never
 * trusts model output (or the static prompt bank) to already be clean. */
export class MemoryJoggerVocabViolationError extends Error {
  constructor(public readonly terms: string[]) {
    super(`Memory Jogger prompt used forbidden doctrine vocabulary (§0.5): ${terms.join(', ')}`);
    this.name = 'MemoryJoggerVocabViolationError';
  }
}

export interface CaptureNamedMemoryResult {
  outcome: 'added' | 'existing';
  contactId: string;
}

export class MemoryJoggerService {
  constructor(
    private prisma: PrismaClient = new PrismaClient(),
    private categoryClient: MemoryJoggerCategoryClient = new LocalDeterministicMemoryJoggerCategoryClient(),
    private encryptionKey: string = getContactEncryptionKey()
  ) {}

  /**
   * §7.4 Memory Jogger prompts for one contact. FIX (T-23): every PII field this method reads off
   * the Contact row is now decrypted via `decryptContactPII` before it reaches prompt text — the
   * pre-fix code read `contact.first_name` raw, which is ciphertext after T-22 (see
   * `tests/unit/warm-market.test.ts`'s "reads DECRYPTED contact PII" test for the round-trip proof).
   */
  async generatePrompts(contactId: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      include: { interactions: true },
    });

    if (!contact) return [];

    const pii = decryptContactPII(
      {
        first_name: contact.first_name,
        last_name: contact.last_name,
        phone: contact.phone,
        email: contact.email,
        notes: contact.notes,
      },
      this.encryptionKey
    );

    return [
      `How is ${pii.first_name} doing? Did you talk about ${contact.industry || 'work'} lately?`,
      `Recall the last time you met ${pii.first_name}. What did you learn?`,
    ];
  }

  async getLastInteraction(contactId: string) {
    const interaction = await this.prisma.contactInteraction.findFirst({
      where: { contact_id: contactId },
      orderBy: { created_at: 'desc' },
    });
    return interaction?.created_at || null;
  }

  /** §7.4: "triggered when contact count is low (< 50) or on demand." */
  shouldTrigger(contactCount: number, onDemand = false): boolean {
    return shouldTriggerMemoryJogger(contactCount, onDemand);
  }

  /**
   * §7.4/§4.4 "Haiku 4.5 selects which category prompt to show next." A defensive vocab-clean check
   * runs on top of the injected client's own system-prompt instruction (mirrors
   * `finalizeAnchorStatement`, WP01 §6.4) — never trusts model output to already be clean.
   */
  async selectNextCategoryPrompt(
    recentCategories: MemoryJoggerCategory[] = []
  ): Promise<MemoryJoggerCategoryPrompt> {
    const prompt = await this.categoryClient.selectNextCategory({ recentCategories });
    const violations = findForbiddenTerms(prompt.promptText);
    if (violations.length > 0) {
      throw new MemoryJoggerVocabViolationError(violations);
    }
    return prompt;
  }

  /**
   * §7.4: "New names search the Vault and add if absent; a jogger that surfaces an existing contact
   * increments a counter and skips." Names are compared on DECRYPTED plaintext — ciphertext varies
   * by IV per encryption call, so it can never be compared directly (the same reason `phone_hash`/
   * `email_hash`, not ciphertext, are what dedup/opt-out match against elsewhere in the Vault). This
   * is a decrypt-and-scan over the rep's own contacts, matching the trade-off the Vault list view
   * (`GET /api/contacts/import`) already makes — there is no queryable index over encrypted PII.
   */
  async captureNamedMemory(userId: string, rawName: string): Promise<CaptureNamedMemoryResult> {
    const normalized = rawName.trim().toLowerCase();
    const existingContacts = await this.prisma.contact.findMany({ where: { user_id: userId } });

    for (const existing of existingContacts) {
      const pii = decryptContactPII(
        {
          first_name: existing.first_name,
          last_name: existing.last_name,
          phone: existing.phone,
          email: existing.email,
          notes: existing.notes,
        },
        this.encryptionKey
      );
      const fullName = `${pii.first_name} ${pii.last_name}`.trim().toLowerCase();
      if (fullName === normalized || pii.first_name.trim().toLowerCase() === normalized) {
        await this.prisma.contact.update({
          where: { id: existing.id },
          data: { memory_jogger_skip_count: { increment: 1 } },
        });
        return { outcome: 'existing', contactId: existing.id };
      }
    }

    const { firstName, lastName } = splitName(rawName);
    const created = await this.prisma.contact.create({
      data: {
        user_id: userId,
        first_name: encryptRequiredField(firstName, this.encryptionKey),
        last_name: encryptRequiredField(lastName, this.encryptionKey),
        source: ContactSource.MANUAL,
        segment_score: 0,
      },
    });
    return { outcome: 'added', contactId: created.id };
  }
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || fullName;
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}
