// T-39 (WP05 §10.5/§10.6 "Edification script generator") — auto-generates a personalized, doctrine-
// safe introduction of the rep's upline (from the upline's rank + name), in two lengths: an SMS-length
// (~160 char) bridge and a 200–300-word call-script. Edification is honest respect, never hype: no
// earnings claims, no "guaranteed income", no forbidden doctrine vocabulary. Per §10.6 the script is
// "CFE-cleared before display" — this module produces the copy and exposes the deterministic CFE
// stage-1 (VocabularyClassifier) screen as the key-less display floor; the full CFE pass (Haiku
// classifiers, WP04) runs before it is sent to a recipient. The 3-way handoff itself is
// ThreeWayHandoffService.

import { VocabularyClassifier, type VocabularyScan } from '../../compliance/vocabulary';

export interface UplineProfile {
  displayName: string;
  /** Free-text rank (User.rank), e.g. "Regional Vice President", "Senior Representative". */
  rank?: string | null;
}

export interface EdificationScript {
  /** ~160-char SMS bridge introducing the upline. */
  sms: string;
  /** 200–300-word call-script introduction. */
  callScript: string;
}

export interface EdificationResult {
  script: EdificationScript;
  /** Deterministic CFE stage-1 (doctrine vocabulary) screen over BOTH lengths. `displayable` is the
   *  fail-closed floor: false → the copy must not be shown until it is rewritten/cleared. */
  displayable: boolean;
  scan: VocabularyScan;
}

export class EdificationService {
  constructor(private vocabulary: VocabularyClassifier = new VocabularyClassifier()) {}

  /** Build the edification script and screen it against the doctrine vocabulary (fail-closed). */
  generate(repName: string, upline: UplineProfile): EdificationResult {
    const rankPhrase = upline.rank && upline.rank.trim().length > 0 ? ` — ${upline.rank.trim()}` : '';

    const sms =
      `I'd love for you to meet ${upline.displayName}${rankPhrase}. `
      + `They've helped a lot of families like yours, and I trust them completely. Okay if I introduce you?`;

    // QC FIX (T-39 must-fix #2, §10.6): the call-script floor is 200-300 WORDS, not characters —
    // this copy is deliberately written long enough to clear that floor with a comfortable margin
    // on both ends (283 words with no rank, 287 with one — see edification.service.test.ts's word-
    // count teeth test) while staying doctrine-clean (no forbidden §0.5 vocabulary).
    const callScript =
      `Before we go further, I want to introduce someone who means a lot to me: ${upline.displayName}`
      + `${rankPhrase}. When I first started, ${upline.displayName} was the person who showed me this was really about `
      + `taking care of the people in my life, not chasing anyone. `
      + `I've watched them sit with families, answer every question honestly, and never once push. `
      + `The reason I want you to hear from them directly is simple: they can answer the deeper questions far better than I can, `
      + `and you deserve straight answers from someone who has done this for years. `
      + `Everything they share is checkable, and there is never any pressure — if the timing or the fit isn't right for you, `
      + `that is completely okay, and we would both respect that. `
      + `This isn't a script and it isn't a routine — it's just two people who happen to know a little more than I do, `
      + `spending real time with you because they think you matter, not because anything is owed. `
      + `I've watched ${upline.displayName} sit through hard questions from people who were unsure, and they never once got defensive; `
      + `they just kept being honest, even when honest meant "this might not be the right fit for you," `
      + `and that tells you more about their character than anything I could say on their behalf. `
      + `Seems like you value honesty and people who actually follow through, which is exactly why I think the two of you should talk. `
      + `Take whatever time you need with this — there is no clock running and no wrong answer, whichever way you land. `
      + `If you're open to it, I'll bring ${upline.displayName} into the conversation so you can decide for yourself, on your terms.`;

    const scan = this.vocabulary.scan(`${sms}\n${callScript}`);
    return { script: { sms, callScript }, displayable: scan.clean, scan };
  }
}
