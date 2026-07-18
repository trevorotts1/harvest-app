// WP04 (T-30) — agent runtime Claude client public surface.
//
// NOTE (§0.3 rule 3): there is deliberately NO local/stub client exported here. The only production
// implementation is `AnthropicRuntimeClient`, which fails CLOSED with no key. Tests inject their own
// fakes; no silent stub ever sits on the live path.

export type {
  AgentModelClient,
  AgentGenerationRequest,
  AgentGenerationResult,
} from './runtime-client';
export { AgentModelError, AgentModelTimeoutError, MissingClaudeCredentialError } from './runtime-client';
export { AnthropicRuntimeClient } from './anthropic-runtime-client';
export type { AnthropicRuntimeClientOptions } from './anthropic-runtime-client';
