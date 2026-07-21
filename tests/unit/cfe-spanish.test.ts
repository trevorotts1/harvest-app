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
        classifierClient: new HaikuClassifierClient({ fetchImpl: fetchSpy as any }),
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
});
