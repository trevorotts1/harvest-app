// T-53 — SPANISH CFE (master-spec §17.5; uiux §6.2): "a Spanish community introduction is
// CFE-gated exactly as an English one is." Proves Spanish outbound content is classified + banded
// PASS/FLAG/BLOCK through the SAME engine/pipeline as English (no separate "Spanish path", no
// language-based bypass), that the doctrine vocabulary classifier catches Spanish forbidden terms
// (a Spanish BLOCK case that fires with ZERO Haiku signal, purely from stage-1 vocab), that a
// missing Claude credential fails CLOSED for Spanish content exactly as it does for English (never
// waved through because "it's not English"), and that the injected safe-harbor disclaimer is the
// SPANISH text when the content is Spanish.
import { ComplianceFilterEngine } from '../../src/services/compliance/engine';
import {
  ClaudeClassifierClient,
  ClassifierRequest,
  HaikuClassifierClient,
  LocalDeterministicClassifierClient,
} from '../../src/services/compliance/claude';
import { VocabularyClassifier, FORBIDDEN_TERMS, FORBIDDEN_TERMS_ES, FORBIDDEN_TERMS_ALL } from '../../src/services/compliance/vocabulary';
import { ClassifierVerdict, CFEInput, Classifier, SAFE_HARBOR_DISCLAIMERS_ES } from '../../src/types/compliance';

const ctx: CFEInput['userContext'] = { user_id: 'u-es-1', role: 'REP' };

/** Returns a caller-supplied confidence per classifier (0 for the rest) — same MapClient pattern
 *  as tests/unit/cfe-classifiers.test.ts's licensing-phase suite, reused here for Spanish inputs. */
class MapClient implements ClaudeClassifierClient {
  constructor(private readonly map: Partial<Record<Classifier, number>>) {}
  async classify(req: ClassifierRequest): Promise<ClassifierVerdict> {
    const confidence = this.map[req.classifier] ?? 0;
    return { flagged: confidence >= 0.5, confidence };
  }
}

describe('Spanish CFE — classified + gated through the SAME pipeline as English (§17.5)', () => {
  test('a. clean Spanish content, all classifiers clear -> PASS (released) — Spanish is not held merely for being Spanish', async () => {
    const engine = new ComplianceFilterEngine({ classifierClient: new MapClient({}) });
    const v = await engine.evaluateContent({
      content: 'Qué gusto verte el sábado — ¿almorzamos pronto?',
      channel: 'SMS',
      userContext: ctx,
      language: 'es',
    });
    expect(v.band).toBe('clear');
    expect(v.held).toBe(false);
    expect(v.released).toBe(true);
  });

  test('b. Spanish income-claim content, high confidence -> BLOCKED (auto-block >=0.8), with the SPANISH disclaimer injected', async () => {
    const engine = new ComplianceFilterEngine({ classifierClient: new MapClient({ INCOME_CLAIM: 0.9 }) });
    const v = await engine.evaluateContent({
      content: 'Te garantizo ingresos de $10,000 al mes.',
      channel: 'SMS',
      userContext: ctx,
      language: 'es',
    });
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
    expect(v.safeHarbor.injected).toBe(true);
    expect(v.safeHarbor.disclaimers).toContain(SAFE_HARBOR_DISCLAIMERS_ES.income);
  });

  test('c. Spanish opportunity content, mid confidence -> FLAG (review band), Sonnet-adjudication path, Spanish disclaimer', async () => {
    const engine = new ComplianceFilterEngine({ classifierClient: new MapClient({ OPPORTUNITY: 0.65 }) });
    const v = await engine.evaluateContent({
      content: 'Únete a mi equipo y sé tu propio jefe.',
      channel: 'SMS',
      userContext: ctx,
      language: 'es',
    });
    expect(v.band).toBe('review');
    expect(v.held).toBe(false); // FLAG is not a fail-closed hold — it is a real, positive banding decision
    expect(v.released).toBe(false); // but it is also not released — only 'clear' releases
    expect(v.safeHarbor.disclaimers).toContain(SAFE_HARBOR_DISCLAIMERS_ES.opportunity);
  });

  test('d. Spanish vocabulary BLOCK — fires from stage-1 doctrine vocab lint alone, with ZERO Haiku signal (classifiers all report 0)', async () => {
    const engine = new ComplianceFilterEngine({ classifierClient: new MapClient({}) }); // every classifier confidence 0
    const v = await engine.evaluateContent({
      content: 'Agrega este prospecto a la lista y prepárate para cerrar a este contacto.',
      channel: 'SMS',
      userContext: ctx,
      language: 'es',
    });
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
    expect(v.reason).toContain('forbidden_vocabulary');
    expect(v.reason).toContain('prospecto');
  });

  test('e. a DIFFERENT Spanish doctrine violation ("cliente potencial") also BLOCKS — not just one hardcoded phrase', async () => {
    const engine = new ComplianceFilterEngine({ classifierClient: new MapClient({}) });
    const v = await engine.evaluateContent({
      content: 'Este cliente potencial parece interesado en el negocio.',
      channel: 'SMS',
      userContext: ctx,
      language: 'es',
    });
    expect(v.band).toBe('blocked');
    expect(v.reason).toContain('forbidden_vocabulary');
  });

  test('f. FAIL-CLOSED for Spanish, identical to English: missing ANTHROPIC_API_KEY -> HELD, never released, NO network attempt (Claude-only, §0.3)', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = jest.fn(async () => {
      throw new Error('network must NOT be called when the key is missing — Claude-only, no non-Claude fallback');
    });
    try {
      const engine = new ComplianceFilterEngine({
        classifierClient: new HaikuClassifierClient({ fetchImpl: fetchSpy }),
      });
      const v = await engine.evaluateContent({
        content: 'Hola, ¿cómo estás? Quería contarte algo sobre mi negocio.',
        channel: 'SMS',
        userContext: ctx,
        language: 'es',
      });
      expect(v.held).toBe(true);
      expect(v.released).toBe(false);
      expect(v.heldReason).toBe('missing_credentials');
      expect(fetchSpy).not.toHaveBeenCalled();

      // The DEFAULT engine (real Haiku client, no classifierClient override) ALSO fails closed for
      // Spanish content with no key — proves the production wiring, not just an injected test double.
      const defaultEngine = new ComplianceFilterEngine();
      const dv = await defaultEngine.evaluateContent({
        content: 'Hola, ¿cómo estás? Quería contarte algo sobre mi negocio.',
        channel: 'SMS',
        userContext: ctx,
        language: 'es',
      });
      expect(dv.held).toBe(true);
      expect(dv.released).toBe(false);
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });

  test('g. Spanish content omitting `language` entirely defaults to English disclaimers (byte-identical pre-T-53 behavior) — proves the new field is additive, not a breaking change', async () => {
    const engine = new ComplianceFilterEngine({ classifierClient: new MapClient({ INCOME_CLAIM: 0.9 }) });
    const v = await engine.evaluateContent({
      content: 'Some unrelated English text that happens to trip the mapped classifier.',
      channel: 'SMS',
      userContext: ctx,
      // no `language` field at all
    });
    expect(v.safeHarbor.disclaimers[0]).not.toBe(SAFE_HARBOR_DISCLAIMERS_ES.income);
  });

  test('h. licensing-phase hard-block (§5.5) applies to Spanish insurance content exactly as English — doctrine gates are language-independent', async () => {
    const engine = new ComplianceFilterEngine({ classifierClient: new MapClient({ INSURANCE: 0.3 }) });
    const v = await engine.evaluateContent({
      content: 'Necesitas un seguro de vida entera para tu familia.',
      channel: 'SMS',
      userContext: { user_id: 'u-es-2', role: 'REP', licensing_phase: true },
      language: 'es',
    });
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
    expect(v.reason).toContain('insurance_block_unlicensed_or_licensing_phase');
  });

  test('i. the LOCAL deterministic client (dev/test fallback) also has Spanish parity patterns for income-claim/opportunity signals — not blind to Spanish because no Haiku key is configured locally', async () => {
    const engine = new ComplianceFilterEngine({ classifierClient: new LocalDeterministicClassifierClient() });
    const income = await engine.evaluateContent({
      content: 'Con este negocio tendrás ingresos garantizados de $5,000 al mes.',
      channel: 'SMS',
      userContext: { user_id: 'u-es-3', role: 'REP' },
      language: 'es',
    });
    expect(income.band).toBe('blocked'); // vocab ALSO fires here ("ingreso garantizado" is itself forbidden) — belt and suspenders
    expect(income.released).toBe(false);
  });
});

describe('Doctrine vocabulary — Spanish column (uiux §0.4/§6.2 "the forbidden-vocabulary list has a Spanish column")', () => {
  const classifier = new VocabularyClassifier(); // default = FORBIDDEN_TERMS_ALL (both languages)

  test.each([
    ['Agrega este prospecto a la lista.', 'prospecto'],
    ['Este cliente potencial parece interesado.', 'cliente potencial'],
    ['Prepara la presentación de ventas para mañana.', 'presentación de ventas'],
    ['Agrega esto al embudo de conversión.', 'embudo'],
    ['Necesitamos más seguidores en redes.', 'seguidores'],
    ['Define el público objetivo de esta publicación.', 'público objetivo'],
    ['Vamos a reclutar cinco personas este mes.', 'reclutar'],
    ['El contacto en frío nunca funciona para nosotros.', 'contacto en frío'],
    ['Esto ofrece ingresos garantizados de por vida.', 'ingreso garantizado'],
    ['Ganarás $5,000 en tu primer mes.', 'vas a ganar / ganarás'],
  ])('flags "%s" (forbidden: %s)', (content, expectedForbidden) => {
    const scan = classifier.scan(content);
    expect(scan.clean).toBe(false);
    expect(scan.violations.map((v) => v.forbidden)).toContain(expectedForbidden);
  });

  test('object-gated "vender a [persona]" fires when the PERSON is the object of extraction', () => {
    const scan = classifier.scan('Vamos a vender a este contacto la oportunidad.');
    expect(scan.clean).toBe(false);
    expect(scan.violations.map((v) => v.forbidden)).toContain('vender (a una persona)');
  });

  test('object-gated "cerrar a [persona]" fires when the PERSON is the object', () => {
    const scan = classifier.scan('Necesito cerrar a este prospecto esta semana.');
    expect(scan.clean).toBe(false);
    expect(scan.violations.map((v) => v.forbidden)).toContain('cerrar (a una persona)');
  });

  test('ordinary, unrelated Spanish phrases stay CLEAN — "cerrar sesión" (log out) is not a doctrine violation', () => {
    const scan = classifier.scan('Haz clic aquí para cerrar sesión de tu cuenta.');
    expect(scan.clean).toBe(true);
  });

  test('"cerrar la tienda" / "cerrar el mes" (ordinary commerce/accounting senses) stay CLEAN', () => {
    expect(classifier.scan('Vamos a cerrar la tienda a las 6pm.').clean).toBe(true);
    expect(classifier.scan('El contador va a cerrar el mes el viernes.').clean).toBe(true);
  });

  test('"vender la casa" / "vender un seguro a tu cliente" (ordinary, legitimate commerce) stay CLEAN', () => {
    expect(classifier.scan('Quiere vender la casa antes del verano.').clean).toBe(true);
    expect(classifier.scan('Puedes venderle una póliza a tu cliente esta semana.').clean).toBe(true);
  });

  test('English content is UNAFFECTED by the Spanish rows — no cross-language false positives', () => {
    const scan = classifier.scan('Great seeing you Saturday — lunch soon?');
    expect(scan.clean).toBe(true);
  });

  test('the EN-only export (FORBIDDEN_TERMS) is unchanged at exactly 14 rows — pre-existing test/behavior preserved', () => {
    expect(FORBIDDEN_TERMS).toHaveLength(14);
  });

  test('FORBIDDEN_TERMS_ALL is the union of FORBIDDEN_TERMS and FORBIDDEN_TERMS_ES', () => {
    expect(FORBIDDEN_TERMS_ALL.length).toBe(FORBIDDEN_TERMS.length + FORBIDDEN_TERMS_ES.length);
  });

  test('a VocabularyClassifier constructed with an EXPLICIT EN-only rule list does NOT catch Spanish terms (proves the union is additive/opt-in via the default, not forced)', () => {
    const enOnly = new VocabularyClassifier(FORBIDDEN_TERMS);
    expect(enOnly.scan('Agrega este prospecto a la lista.').clean).toBe(true);
  });

  test('FORBIDDEN_TERMS_ES row count is unchanged (14) — T-R34 only edited existing rows\' patterns, added zero/removed zero rows', () => {
    expect(FORBIDDEN_TERMS_ES).toHaveLength(14);
  });
});

/**
 * T-R34 (compliance fix): the Spanish forbidden-term classifier under-blocked several INFLECTED
 * (mostly plural) forms — confirmed via direct `RegExp.test()` against the pre-fix
 * `src/services/compliance/vocabulary.ts` patterns. Spanish regularly pluralizes by adding "-s"/
 * "-es" (and, for words ending in an accented vowel + "n" — "conversión", "presentación" — DROPS
 * the accent on pluralization: "conversión" -> "conversiones", not "conversións"), so a
 * singular-only `\bterm\b` word-boundary regex silently lets the plural straight through stage-1.
 *
 * Each `it.each` row below is a MUTATION PROOF: revert the corresponding fix in vocabulary.ts (put
 * back the singular-only pattern) and that row's assertion fails — the classifier would return
 * `clean: true` for content containing ONLY the plural/inflected form, exactly as it did before
 * this fix (confirmed missed pre-fix; see the `beforeFix` regexes inlined below, copied verbatim
 * from the pre-fix source, each of which `.test()`s false against its row's content).
 */
describe('T-R34 — Spanish forbidden-term INFLECTED forms now caught (were missed pre-fix)', () => {
  const classifier = new VocabularyClassifier(); // default = FORBIDDEN_TERMS_ALL (both languages)

  describe('confirmed-missing terms (QC-confirmed via direct RegExp.test)', () => {
    const beforeFix: Record<string, RegExp> = {
      conversión: /\bconversi[oó]n\b/i,
      embudo: /\bembudo\b/i,
      'contacto en frío': /\bcontacto\s+en\s+fr[ií]o\b/i,
      'presentación de ventas': /\b(?:discurso|presentaci[oó]n)\s+de\s+ventas?\b/i,
    };

    const inflectedCases: Array<[string, string, string]> = [
      ['Revisamos las conversiones del mes pasado.', 'conversión', 'conversiones'],
      ['Metimos a este contacto en los embudos de la campaña.', 'embudo', 'embudos'],
      ['Los contactos en frío nunca funcionan para nuestro equipo.', 'contacto en frío', 'contactos en frío'],
      ['Prepara las presentaciones de ventas para mañana.', 'presentación de ventas', 'presentaciones de ventas'],
      ['Revisa los discursos de ventas antes de la llamada.', 'presentación de ventas', 'discursos de ventas'],
    ];

    it.each(inflectedCases)(
      'BEFORE(missed) / AFTER(caught): "%s" now flags forbidden "%s" via inflected form "%s"',
      (content, expectedForbidden, inflectedForm) => {
        // AFTER: the current (fixed) classifier catches it.
        const scan = classifier.scan(content);
        expect(scan.clean).toBe(false);
        expect(scan.violations.map((v) => v.forbidden)).toContain(expectedForbidden);

        // BEFORE: the pre-fix pattern, run directly against the SAME content, misses it — proving
        // this is a genuine before(missed)->after(caught) delta and not a pre-existing pass.
        expect(beforeFix[expectedForbidden].test(content)).toBe(false);
        expect(content.toLowerCase()).toContain(inflectedForm.toLowerCase());
      }
    );
  });

  describe('audit-fix terms (found while auditing the rest of the list for the same defect class)', () => {
    test('"reclutada"/"reclutadas" (feminine past-participle forms) now flagged — pre-fix pattern only covered the masculine "reclutado(s)"', () => {
      const beforeFixReclut = /\breclut(?:ar|amiento|ando|ados?|as)\b/i;
      const singular = 'Ella fue reclutada la semana pasada por su hermana.';
      const plural = 'Ellas fueron reclutadas ayer durante el evento.';

      expect(beforeFixReclut.test(singular)).toBe(false);
      expect(beforeFixReclut.test(plural)).toBe(false);

      expect(classifier.scan(singular).clean).toBe(false);
      expect(classifier.scan(singular).violations.map((v) => v.forbidden)).toContain('reclutar');
      expect(classifier.scan(plural).clean).toBe(false);
      expect(classifier.scan(plural).violations.map((v) => v.forbidden)).toContain('reclutar');
    });

    test('"públicos objetivo(s)" (pluralized compound phrase) now flagged — pre-fix pattern only matched the fully-singular phrase', () => {
      const beforeFixPublico = /\bp[uú]blico\s+objetivo\b/i;
      const content = 'Definimos los públicos objetivo de cada campaña regional.';

      expect(beforeFixPublico.test(content)).toBe(false);

      const scan = classifier.scan(content);
      expect(scan.clean).toBe(false);
      expect(scan.violations.map((v) => v.forbidden)).toContain('público objetivo');
    });
  });

  describe('end-to-end: the RUNTIME CFE (full engine, not just the bare classifier) BLOCKS Spanish content on an inflected form alone, zero Haiku signal', () => {
    test('plural "conversiones" alone triggers a stage-1 BLOCK through the full pipeline', async () => {
      const engine = new ComplianceFilterEngine({ classifierClient: new MapClient({}) }); // every classifier confidence 0
      const v = await engine.evaluateContent({
        content: 'Necesitamos mejorar las conversiones de este mes en el equipo.',
        channel: 'SMS',
        userContext: ctx,
        language: 'es',
      });
      expect(v.band).toBe('blocked');
      expect(v.released).toBe(false);
      expect(v.reason).toContain('forbidden_vocabulary');
      expect(v.reason).toContain('conversión');
    });

    test('plural "contactos en frío" alone triggers a stage-1 BLOCK through the full pipeline', async () => {
      const engine = new ComplianceFilterEngine({ classifierClient: new MapClient({}) });
      const v = await engine.evaluateContent({
        content: 'Los contactos en frío no han respondido esta semana.',
        channel: 'SMS',
        userContext: ctx,
        language: 'es',
      });
      expect(v.band).toBe('blocked');
      expect(v.released).toBe(false);
      expect(v.reason).toContain('forbidden_vocabulary');
      expect(v.reason).toContain('contacto en frío');
    });

    test('plural "presentaciones de ventas" alone triggers a stage-1 BLOCK through the full pipeline', async () => {
      const engine = new ComplianceFilterEngine({ classifierClient: new MapClient({}) });
      const v = await engine.evaluateContent({
        content: 'Terminamos las presentaciones de ventas de esta semana.',
        channel: 'SMS',
        userContext: ctx,
        language: 'es',
      });
      expect(v.band).toBe('blocked');
      expect(v.released).toBe(false);
      expect(v.reason).toContain('forbidden_vocabulary');
      expect(v.reason).toContain('presentación de ventas');
    });
  });

  describe('benign Spanish controls are NOT over-blocked by the widened (plural/accent-insensitive) patterns', () => {
    const benignCases: string[] = [
      // "conversación"/"conversaciones" (conversation) must stay clean — the new `(?:es)?` suffix
      // on "conversión" must not widen the match to this unrelated, common word.
      'Tuvimos una conversación agradable con la familia el domingo.',
      'Las conversaciones familiares fueron muy amenas esta semana.',
      // Bare plural "contactos" with no "en frío" must stay clean — only the full phrase is banned.
      'Actualiza los contactos de la agenda antes del viernes.',
      // Bare plural "discursos" with no "de ventas" must stay clean.
      'Escribió varios discursos para la boda de su hermana.',
      // Bare "público"/"públicos" with no "objetivo" must stay clean.
      'El parque es público y lo visitan muchas familias los domingos.',
      'Los públicos de cada canal de streaming son muy distintos.',
      // Bare "objetivo(s)" with no "público" must stay clean.
      'Nuestro objetivo este trimestre es mejorar la comunicación interna.',
    ];

    it.each(benignCases)('leaves "%s" clean', (content) => {
      expect(classifier.scan(content).clean).toBe(true);
    });
  });
});

/**
 * T-57 BLOCKER-B1 (uiux §6.2/§17.5 CFE fail-closed gate): the Spanish "vender"/"cerrar"
 * object-gated rows (vocabulary.ts:119,130) require the extraction-object to be introduced by a
 * determiner from a fixed set — `este|esta|ese|esa|mi|nuestro|nuestra` — which OMITS the entire
 * possessive-determiner paradigm `tu|tus|su|sus|vuestro|vuestra`. Since "close/sell TO YOUR
 * contact" ("cerrar/vender a tu/su contacto") is exactly as doctrine-forbidden as "close/sell to
 * THIS contact", the omission is a live fail-closed hole: real REP-composed content using the far
 * more natural "tu"/"su" possessive (rather than "este"/"ese") slides straight through stage-1
 * with ZERO Haiku signal required to catch it downstream.
 *
 * Each `beforeFix` regex below is copy-pasted verbatim from the pre-fix vocabulary.ts source and
 * is asserted to `.test() === false` against the same content the (fixed) classifier now catches
 * — a genuine before(missed)/after(caught) mutation proof, matching this file's existing T-R34
 * convention above.
 */
describe('T-57 BLOCKER-B1 — Spanish possessive determiners (tu/tus/su/sus/vuestro/vuestra) in "vender a"/"cerrar a" object-gating', () => {
  const classifier = new VocabularyClassifier(); // default = FORBIDDEN_TERMS_ALL (both languages)

  // Verbatim pre-fix patterns (copied from vocabulary.ts before the T-57 R1a fix) — used as the
  // RED-state oracle: every case in `possessiveCases` below must `.test() === false` against these.
  const beforeFixVender =
    /\bvend(?:er|iendo|ió|en)\s+a\s+(?:él|ella|ellos|ellas)\b|\bvend(?:er|iendo|ió|en)\s+a\s+(?:este|esta|ese|esa|mi|nuestro|nuestra)\s+(?:contacto|prospecto|cliente\s+potencial)\b|\bvend(?:er|iendo|ió|en)\s+(?:la\s+)?(?:oportunidad|el\s+trato|el\s+sue[nñ]o|el\s+negocio)\b/i;
  const beforeFixCerrar =
    /\bcerr(?:ar|ando|ó)\s+a\s+(?:él|ella|ellos|ellas)\b|\bcerr(?:ar|ando|ó)\s+a\s+(?:este|esta|ese|esa|mi|nuestro|nuestra)\s+(?:contacto|prospecto|cliente\s+potencial)\b|\bcerr(?:ar|ando|ó)\s+(?:el\s+trato|la\s+venta)\s+con\s+(?:este|esta|ese|esa|mi|nuestro|nuestra)\s+(?:contacto|prospecto|cliente\s+potencial)\b/i;

  describe('possessive determiners now caught (were missed pre-fix — confirmed via direct RegExp.test)', () => {
    const venderCases: Array<[string, string]> = [
      ['Vamos a vender a tu contacto la oportunidad.', 'tu + contacto (singular)'],
      ['No deberías vender a tus contactos así.', 'tus + contactos (plural)'],
      ['Quiere vender a su prospecto el negocio.', 'su + prospecto (singular)'],
      ['Van a vender a sus prospectos el sueño.', 'sus + prospectos (plural)'],
      ['Piensan vender a vuestro contacto la oportunidad.', 'vuestro + contacto'],
      ['No deberíais vender a vuestra cliente potencial el negocio.', 'vuestra + cliente potencial'],
    ];

    it.each(venderCases)('AFTER(caught): "%s" [%s] now flags "vender (a una persona)"', (content) => {
      const scan = classifier.scan(content);
      expect(scan.clean).toBe(false);
      expect(scan.violations.map((v) => v.forbidden)).toContain('vender (a una persona)');
      // BEFORE: the verbatim pre-fix pattern misses it — proves a genuine before/after delta.
      expect(beforeFixVender.test(content)).toBe(false);
    });

    const cerrarCases: Array<[string, string]> = [
      ['Necesito cerrar a tu prospecto esta semana.', 'tu + prospecto (singular)'],
      // NOTE: uses the infinitive "cerrar" (not the subjunctive "cierres") — the verb-form
      // alternation `cerr(?:ar|ando|ó)` only covers infinitive/gerund/3rd-person-preterite, so a
      // stem-changing conjugation like "cierres" would never match regardless of this fix.
      ['No deberías cerrar a tus contactos tan rápido.', 'tus + contactos (plural)'],
      // The exact BLOCKER-B1 audit example (findings.md): "cerrar a su prospecto".
      ['Prepárate para cerrar a su prospecto.', 'su + prospecto (singular) — audit example'],
      ['Van a cerrar a sus clientes potenciales antes del viernes.', 'sus + clientes potenciales (plural)'],
      ['Deberíais cerrar a vuestro contacto pronto.', 'vuestro + contacto'],
      // NOTE: uses the infinitive "cerrar" (not the vosotros form "cerréis") for the same reason.
      ['No deberíais cerrar a vuestra cliente potencial sin avisar.', 'vuestra + cliente potencial'],
    ];

    it.each(cerrarCases)('AFTER(caught): "%s" [%s] now flags "cerrar (a una persona)"', (content) => {
      const scan = classifier.scan(content);
      expect(scan.clean).toBe(false);
      expect(scan.violations.map((v) => v.forbidden)).toContain('cerrar (a una persona)');
      // BEFORE: the verbatim pre-fix pattern misses it — proves a genuine before/after delta.
      expect(beforeFixCerrar.test(content)).toBe(false);
    });

    test('the exact bare fragments quoted in the T-57 remediation ticket are both caught', () => {
      expect(classifier.scan('vender a tu contacto').clean).toBe(false);
      expect(classifier.scan('vender a tus contactos').clean).toBe(false);
      expect(classifier.scan('cerrar a su prospecto').clean).toBe(false);
    });

    test('end-to-end: the RUNTIME CFE blocks "vender a tu contacto" through the full pipeline, zero Haiku signal', async () => {
      const engine = new ComplianceFilterEngine({ classifierClient: new MapClient({}) });
      const v = await engine.evaluateContent({
        content: 'Voy a vender a tu contacto la oportunidad esta semana.',
        channel: 'SMS',
        userContext: ctx,
        language: 'es',
      });
      expect(v.band).toBe('blocked');
      expect(v.released).toBe(false);
      expect(v.reason).toContain('forbidden_vocabulary');
    });
  });

  describe('should-not-match controls — possessives alone do not over-broaden the noun/verb gate', () => {
    test('"tu equipo" / "su casa" as the OBJECT of vender/cerrar stay CLEAN — only the doctrine-specific noun set (contacto/prospecto/cliente potencial) is gated, not any noun', () => {
      expect(classifier.scan('Vamos a vender a tu equipo la nueva promoción.').clean).toBe(true);
      expect(classifier.scan('Vamos a cerrar a su casa antes de las 6.').clean).toBe(true);
    });

    test('bare possessive phrases with NO vender/cerrar verb at all stay CLEAN (sanity control)', () => {
      expect(classifier.scan('Ve a tu casa a descansar, nos vemos con tu equipo mañana.').clean).toBe(true);
      expect(classifier.scan('Su casa y sus cosas están listas para la mudanza.').clean).toBe(true);
    });

    // Deliberately NOT widened: bare "cliente(s)" (no "potencial") is excluded from the vender/cerrar
    // noun set on purpose, exactly like the pre-existing "vender la casa" / "venderle una póliza a tu
    // cliente" controls above — "vender a sus clientes" / "cerrar a sus clientes" is ordinary,
    // legitimate commerce/business language (selling product to your existing paying clients), NOT
    // the extraction framing doctrine forbids (which targets prospectos/contactos/clientes
    // POTENCIALES — i.e. not-yet-converted people). Adding bare "cliente" here would reintroduce
    // exactly the over-broadening this file's "cliente potencial" (not bare "cliente") design choice
    // already avoids. The equivalent doctrine-noun phrase ("clientes potenciales") IS caught above.
    test('bare "clientes" (no "potencial") as the object of vender/cerrar stays CLEAN — intentionally NOT in the gated noun set (avoids over-blocking ordinary "sell/close to your [paying] clients" commerce language)', () => {
      expect(classifier.scan('Vamos a vender a sus clientes el nuevo producto.').clean).toBe(true);
      expect(classifier.scan('Necesito cerrar a sus clientes esta semana.').clean).toBe(true);
    });

    test('possessives elsewhere in a sentence, with no "vender a"/"cerrar a" + doctrine-noun shape, stay CLEAN', () => {
      expect(classifier.scan('Tu equipo cerró la tienda temprano hoy.').clean).toBe(true);
      expect(classifier.scan('Su cliente llamó para cerrar sesión de la cuenta.').clean).toBe(true);
    });
  });
});

/**
 * T-57 BLOCKER-B2 (uiux §6.2/§17.5): the Spanish "reclut" stem regex (vocabulary.ts:153) covers
 * the verb paradigm (reclutar/reclutando/reclutó/reclutas) and past-participle/adjective forms
 * (reclutado/reclutada/reclutados/reclutadas) but MISSES the agentive noun "reclutador/a(s)" — the
 * Spanish word for "recruiter", i.e. the doctrine-forbidden ROLE noun itself, not just the verb.
 * This is a live fail-closed hole: content that names someone as a "reclutador"/"reclutadora"
 * (rather than using the verb "reclutar") slides through stage-1 untouched.
 */
describe('T-57 BLOCKER-B2 — Spanish agentive noun "reclutador/a(s)" ("recruiter") in the reclut regex', () => {
  const classifier = new VocabularyClassifier();
  // Verbatim pre-fix pattern (copied from vocabulary.ts before the T-57 R1a fix).
  const beforeFixReclut = /\breclut(?:ar|amiento|ando|ad[oa]s?|as)\b/i;

  const agentiveCases: Array<[string, string]> = [
    ['Él es un reclutador experimentado en la empresa.', 'reclutador'],
    ['Ella trabaja como reclutadora para el equipo regional.', 'reclutadora'],
    ['Contratamos varios reclutadores este año.', 'reclutadores'],
    ['Todas las reclutadoras se reunieron ayer por la tarde.', 'reclutadoras'],
  ];

  it.each(agentiveCases)('AFTER(caught): "%s" now flags "reclutar" via the agentive form', (content) => {
    const scan = classifier.scan(content);
    expect(scan.clean).toBe(false);
    expect(scan.violations.map((v) => v.forbidden)).toContain('reclutar');
    // BEFORE: the verbatim pre-fix pattern misses every agentive-noun form.
    expect(beforeFixReclut.test(content)).toBe(false);
  });

  test('should-not-match control: unrelated words merely sharing a prefix stay CLEAN', () => {
    // "reclutamiento" (recruitment, an existing/legitimate pre-fix match) is unaffected; this is a
    // sanity control that the new "ador(?:a|es|as)?" suffix branch did not loosen the required
    // \breclut... stem or trailing \b boundary in some way that catches unrelated words.
    expect(classifier.scan('Prepara el informe trimestral de ventas.').clean).toBe(true);
    expect(classifier.scan('El reclutamiento de voluntarios sigue abierto.').clean).toBe(false); // pre-existing, unaffected
  });

  test('end-to-end: the RUNTIME CFE blocks "reclutador" through the full pipeline, zero Haiku signal', async () => {
    const engine = new ComplianceFilterEngine({ classifierClient: new MapClient({}) });
    const v = await engine.evaluateContent({
      content: 'Nuestro mejor reclutador cerró cinco incorporaciones este mes.',
      channel: 'SMS',
      userContext: ctx,
      language: 'es',
    });
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
    expect(v.reason).toContain('forbidden_vocabulary');
  });
});
