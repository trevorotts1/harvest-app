import { VocabularyMode, CFE_VOCABULARY_MODE_ENV_VAR } from '../../../types/compliance';

/**
 * T-R51 (OBSERVE variant) — resolves the §0.5 doctrine-vocabulary mode from `CFE_VOCABULARY_MODE`.
 *
 * The vocabulary hard-block is IDENTICAL in both modes — this only decides whether a catch is ALSO
 * recorded/surfaced (see `types/compliance.ts`'s `VocabularyMode` doc for the full contract).
 *
 * Fails toward 'observe' (the more-observable option) for anything unset or unrecognized —
 * matching the operator's explicit "default 'observe' now" decision. There is no way to
 * accidentally end up LESS observable than intended by mistyping the env var; the only way to get
 * legacy ('block', no observability record) behavior is to set it EXACTLY to `'block'`.
 */
export function getVocabularyMode(env: NodeJS.ProcessEnv = process.env): VocabularyMode {
  return env[CFE_VOCABULARY_MODE_ENV_VAR] === 'block' ? 'block' : 'observe';
}
