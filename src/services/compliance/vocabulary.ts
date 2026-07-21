/**
 * Doctrine vocabulary classifier (master-spec §0.5, referenced by §5.3).
 *
 * Runs as CFE stage-1 (deterministic, local, fast). Forbidden doctrine terms
 * trigger a required rewrite "before the item can proceed" — so a violation
 * holds the item out of release. The forbidden list is config (a doctrine
 * change is an edit here, not in the engine).
 */

export interface ForbiddenTermRule {
  term: RegExp;
  forbidden: string;
  replacement: string;
}

/** §0.5 forbidden → required-replacement table. */
export const FORBIDDEN_TERMS: ForbiddenTermRule[] = [
  { term: /\bprospects?\b/i, forbidden: 'prospect', replacement: 'community member / warm-market contact' },
  { term: /\bleads?\b/i, forbidden: 'lead', replacement: 'community member / contact' },
  { term: /\b(?:sales\s*)?pitch(?:es|ing|ed)?\b/i, forbidden: 'pitch', replacement: 'community introduction / share / invite' },
  { term: /\bsales\s*call\b/i, forbidden: 'sales call', replacement: 'community introduction' },
  // §0.5 row 3 "selling / closing (as extraction)". Deliberately NOT a bare
  // \bsell\b / \bclos(?:e|ing)\b — those are common English words with
  // legitimate senses this classifier must not trip on: "close of business",
  // "close rate" (§9.7's Field Trainer's Ratio — a human CLOSE RATE metric,
  // not extraction framing), "CLOSED_RECRUIT" (the pipeline-stage enum;
  // already word-boundary-safe since `_` is a \w char, but excluded on
  // whitespace grounds here too), "closing the loop", "close friend", and
  // (post T-R15-QC-7.3 fix) ordinary transaction/accounting/furniture uses
  // of "close(d) the deal" — "closed the deal on her new apartment/car/the
  // merger", "hard close of the books", "soft close drawers" — which have NO
  // person/extraction-object in them and must stay clean.
  //
  // The "closing" rule below therefore REQUIRES an explicit extraction-object
  // cue rather than matching bare "close/closed the deal/sale": either (1)
  // the thing being closed is a PERSON — them/him/her/(the/this/a/my/our)
  // contact/prospect/lead — directly as the verb's object ("close them",
  // "closing the prospect"), or (2) "close/closing/closed the sale/deal" is
  // followed by "with"/"on" + that same person-noun ("close the deal with
  // this contact"), or (3) the "sales closer" / "sale closing" idiom (sale(s)
  // immediately before the close verb). Ordinary objects after "on" (a
  // house, a car, the merger, the books, drawers) never satisfy the
  // person-noun requirement, so they no longer match. The bare "hard/soft
  // close" alternative was REMOVED entirely — it had no object gating at
  // all and could not be reliably distinguished by regex from the
  // accounting ("hard close of the books") and furniture ("soft-close
  // drawers") senses of the same words; the patterns below already cover
  // the genuine sales-technique "hard/soft close" cases whenever they're
  // actually aimed at a person.
  {
    term: /\bsell(?:ing|s)?\s+(?:them\b|him\b|her\b|(?:the\s+)?(?:opportunity|deal|dream|business)\b)/i,
    forbidden: 'selling',
    replacement: 'inviting, introducing, welcoming, onboarding',
  },
  {
    term: /\bclos(?:e|es|ing|ed)\s+(?:them|him|her|(?:(?:this|that|the|a|my|our)\s+)?(?:contact|prospect|lead)s?)\b|\bclos(?:e|es|ing|ed)\s+(?:the\s+)?(?:sale|deal)\s+(?:with|on)\s+(?:(?:this|that|the|a|my|our)\s+)?(?:contact|prospect|lead)s?\b|\bsales?\s*clos(?:e|es|er|ing)\b/i,
    forbidden: 'closing',
    replacement: 'inviting, introducing, welcoming, onboarding',
  },
  { term: /\bfunnel\b/i, forbidden: 'funnel', replacement: 'introduction pipeline / harvest pipeline' },
  { term: /\bconversion\b/i, forbidden: 'conversion', replacement: 'engagement step / introduction completion' },
  { term: /\bfollowers?\b/i, forbidden: 'follower', replacement: 'community member / base member / subscriber' },
  { term: /\btarget\s*audience\b/i, forbidden: 'target audience', replacement: 'community / downline / base' },
  { term: /\brecruit(?:ing|s|ed|ment)?\b/i, forbidden: 'recruit', replacement: 'invite / sponsor / bring in' },
  { term: /\bcold\s*outreach\b/i, forbidden: 'cold outreach', replacement: 'community introduction (a warm context is always required)' },
  { term: /\bguaranteed\s*income\b/i, forbidden: 'guaranteed income', replacement: 'potential (with the FTC safe-harbor line attached)' },
  { term: /\byou\s*will\s*earn\b/i, forbidden: 'you will earn', replacement: 'potential (with the FTC safe-harbor line attached)' },
];

/**
 * T-53 (master-spec §17.5 / uiux §6.2): the Spanish column of the same doctrine forbidden-vocabulary
 * table — "the doctrine copy-lint ... runs on both languages — the forbidden-vocabulary list has a
 * Spanish column, and the CFE's Spanish classifiers gate Spanish outreach exactly as English."
 * `VocabularyClassifier.scan()` doesn't need a language parameter to enforce this: it just applies
 * EVERY rule in its list to the content, and an English regex essentially never matches genuine
 * Spanish prose (and vice versa), so simply adding these rows to the classifier's DEFAULT rule set
 * (see `FORBIDDEN_TERMS_ALL` below) extends doctrine enforcement to Spanish content with no new
 * language-detection logic anywhere in the CFE pipeline — a Spanish community introduction is
 * vocabulary-gated by the exact same code path as an English one.
 *
 * Kept as a SEPARATE export (not merged into `FORBIDDEN_TERMS` above) because
 * `tests/unit/vocabulary-classifier.test.ts` asserts `FORBIDDEN_TERMS` has EXACTLY 14 rows (the
 * pre-existing English table) — that test is this file's own regression guard for the English
 * doctrine list and must keep passing unmodified per this build's "preserve all existing EN
 * behavior + tests" invariant.
 *
 * Translated by MEANING per uiux §6.2 ("vision-voice lines are translated by meaning, not
 * literally"), and — like the English "closing"/"selling" rows — the higher-false-positive terms
 * ("cerrar", "vender") are OBJECT-GATED so common, unrelated Spanish UI/product phrases are never
 * caught: "cerrar sesión" (log out), "cerrar la tienda" (close the shop), "cerrar el mes" (close
 * the books) all stay clean, mirroring the English rule's own "close of business" / "close rate" /
 * "closed the deal on her apartment" exemptions.
 */
export const FORBIDDEN_TERMS_ES: ForbiddenTermRule[] = [
  { term: /\bprospectos?\b/i, forbidden: 'prospecto', replacement: 'miembro de la comunidad / contacto de mercado cálido' },
  // NOTE: Spanish pluralizes "potencial" -> "potenciales" (adds "-es", not just "-s") — the pattern
  // is `potencial(?:es)?`, NOT `potenciales?` (which would require the misspelled "potenciale" and
  // silently never match the singular "potencial" at all; caught by this file's own test suite).
  { term: /\bclientes?\s+potencial(?:es)?\b/i, forbidden: 'cliente potencial', replacement: 'miembro de la comunidad / contacto' },
  // T-R34 fix: "discurso"/"presentación" both pluralize regularly ("discursos", "presentaciones" —
  // the latter also drops its accent on pluralization, o→ó→"iones", same phenomenon as
  // "conversión"→"conversiones" below), and the pre-fix pattern only matched the singular of each,
  // so "presentaciones de ventas" / "discursos de ventas" slipped the runtime classifier entirely
  // (confirmed via direct RegExp.test — see tests/unit/cfe-spanish.test.ts).
  { term: /\b(?:discursos?|presentaci[oó]n(?:es)?)\s+de\s+ventas?\b/i, forbidden: 'presentación de ventas', replacement: 'introducción comunitaria / invitación' },
  { term: /\bcitas?\s+de\s+ventas?\b/i, forbidden: 'cita de ventas', replacement: 'introducción comunitaria' },
  // "vender/venta" — object-gated exactly like the English "selling" row: only when the thing being
  // sold is a PERSON, marked either by the "a [persona]" prepositional-object construction (the
  // grammatical way Spanish marks a personal direct object here — "vender a este contacto") or by
  // the extraction-framed noun itself (oportunidad/trato/sueño/negocio). Deliberately does NOT use
  // the bare clitic pronouns le/les/lo/la: those attach directly to the verb in real Spanish
  // ("venderle", "venderlo" — one word, no space) rather than appearing as a separate following
  // token the way this rule would need to match them, AND — even attached — "venderle" alone is
  // routinely legitimate commerce ("venderle una póliza a tu cliente", sell a client a policy),
  // unlike the English "selling them" which has no product complement. So this rule only fires on
  // the unambiguous personal-direct-object pattern, same discipline as the English "sell them/him/
  // her" row. Ordinary "vender" (sell a product, a house, an idea) stays clean.
  {
    term: /\bvend(?:er|iendo|ió|en)\s+a\s+(?:él|ella|ellos|ellas)\b|\bvend(?:er|iendo|ió|en)\s+a\s+(?:este|esta|ese|esa|mi|nuestro|nuestra)\s+(?:contacto|prospecto|cliente\s+potencial)\b|\bvend(?:er|iendo|ió|en)\s+(?:la\s+)?(?:oportunidad|el\s+trato|el\s+sue[nñ]o|el\s+negocio)\b/i,
    forbidden: 'vender (a una persona)',
    replacement: 'invitar, presentar, dar la bienvenida, incorporar',
  },
  // "cerrar" — object-gated exactly like the English "closing" row: only when the direct object of
  // "cerrar/cerrando/cerró" is an explicit personal noun via "a [persona]" (a él/a ella/a ellos/a
  // este contacto/a ese prospecto), or "cerrar el trato/la venta CON esa persona" — the same two
  // shapes the English rule uses. Bare clitics (le/les) are excluded for the same real-grammar
  // reason as the "vender" rule above. Plain "cerrar sesión" (log out), "cerrar la tienda", "cerrar
  // el mes/los libros" never match — there is no personal object at all, let alone this shape.
  {
    term: /\bcerr(?:ar|ando|ó)\s+a\s+(?:él|ella|ellos|ellas)\b|\bcerr(?:ar|ando|ó)\s+a\s+(?:este|esta|ese|esa|mi|nuestro|nuestra)\s+(?:contacto|prospecto|cliente\s+potencial)\b|\bcerr(?:ar|ando|ó)\s+(?:el\s+trato|la\s+venta)\s+con\s+(?:este|esta|ese|esa|mi|nuestro|nuestra)\s+(?:contacto|prospecto|cliente\s+potencial)\b/i,
    forbidden: 'cerrar (a una persona)',
    replacement: 'invitar, presentar, dar la bienvenida, incorporar',
  },
  // T-R34 fix: "embudo" regularly pluralizes to "embudos" — the pre-fix `\bembudo\b` word-boundary
  // pattern excluded it (no boundary between "o" and a trailing "s"), so plural funnel-language
  // slipped the runtime classifier (confirmed via direct RegExp.test).
  { term: /\bembudos?\b/i, forbidden: 'embudo', replacement: 'proceso de introducción / proceso de cosecha' },
  // T-R34 fix: same accent-drop-on-pluralization phenomenon documented on "potencial"/"seguidor"
  // above — "conversión" -> "conversiones" drops its accent (ó -> o) AND the pre-fix pattern had no
  // `(?:es)?` plural suffix at all, so "conversiones" slipped the runtime classifier entirely
  // (confirmed via direct RegExp.test).
  { term: /\bconversi[oó]n(?:es)?\b/i, forbidden: 'conversión', replacement: 'paso de compromiso / finalización de la introducción' },
  // Same pluralization note as "potencial" above: "seguidor" -> "seguidores" adds "-es".
  { term: /\bseguidor(?:es)?\b/i, forbidden: 'seguidores', replacement: 'miembro de la comunidad / miembro base / suscriptor' },
  // T-R34 audit fix: both words of this compound noun phrase can independently pluralize
  // ("públicos objetivo(s)" — used when copy refers to more than one target-audience segment); the
  // pre-fix pattern only matched the fully-singular phrase, so any pluralized variant slipped the
  // runtime classifier. Also accent-insensitive (público/publico) like the rest of this file.
  { term: /\bp[uú]blicos?\s+objetivos?\b/i, forbidden: 'público objetivo', replacement: 'comunidad / equipo / base' },
  // T-R34 audit fix: added the feminine past-participle forms "reclutada"/"reclutadas" (the pre-fix
  // pattern's `ados?` alternative only covered the masculine "reclutado(s)") — same inflection-gap
  // class as the confirmed-missing terms above, just gender agreement instead of pluralization.
  { term: /\breclut(?:ar|amiento|ando|ad[oa]s?|as)\b/i, forbidden: 'reclutar', replacement: 'invitar / auspiciar / sumar' },
  // T-R34 fix: "contacto" pluralizes regularly to "contactos" (first word of the phrase); the
  // pre-fix pattern only matched the singular "contacto en frío", so "contactos en frío" slipped
  // the runtime classifier entirely (confirmed via direct RegExp.test).
  { term: /\bcontactos?\s+en\s+fr[ií]o\b/i, forbidden: 'contacto en frío', replacement: 'introducción comunitaria (siempre requiere un contexto cálido)' },
  { term: /\bingresos?\s+garantizados?\b/i, forbidden: 'ingreso garantizado', replacement: 'potencial (con la cláusula de exención de la FTC adjunta)' },
  { term: /\b(?:vas\s+a\s+ganar|ganar[aá]s)\b/i, forbidden: 'vas a ganar / ganarás', replacement: 'potencial (con la cláusula de exención de la FTC adjunta)' },
];

/**
 * The union the CFE (and every other `new VocabularyClassifier()` caller — the WP06 doctrine guard,
 * the harvest-method doctrine notes) uses by DEFAULT: both languages' forbidden-vocabulary rows.
 * `FORBIDDEN_TERMS` above stays English-only and unchanged for the pre-existing test's exact-count
 * assertion; this is the "both languages" surface every real caller actually gets.
 */
export const FORBIDDEN_TERMS_ALL: ForbiddenTermRule[] = [...FORBIDDEN_TERMS, ...FORBIDDEN_TERMS_ES];

export interface VocabularyViolation {
  forbidden: string;
  replacement: string;
  match: string;
}

export interface VocabularyScan {
  clean: boolean;
  violations: VocabularyViolation[];
}

export class VocabularyClassifier {
  private readonly rules: ForbiddenTermRule[];

  // T-53: defaults to BOTH languages (§17.5/§6.2 "the doctrine copy-lint ... runs on both
  // languages") — defined below `FORBIDDEN_TERMS_ES` so the identifier is in scope at this point in
  // the module. Every existing bare `new VocabularyClassifier()` call site (this file's own
  // engine.ts default, the WP06 social-content doctrine guard, the harvest-method doctrine notes)
  // now vocab-lints Spanish content too, with zero call-site changes — that is the point.
  constructor(rules: ForbiddenTermRule[] = FORBIDDEN_TERMS_ALL) {
    this.rules = rules;
  }

  scan(content: string): VocabularyScan {
    const violations: VocabularyViolation[] = [];
    for (const rule of this.rules) {
      const m = content.match(rule.term);
      if (m) {
        violations.push({
          forbidden: rule.forbidden,
          replacement: rule.replacement,
          match: m[0],
        });
      }
    }
    return { clean: violations.length === 0, violations };
  }
}
