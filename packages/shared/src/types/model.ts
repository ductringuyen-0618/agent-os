/**
 * Context window sizes, in tokens, for the model ids this repo actually
 * uses -- both the short aliases routines.yaml accepts (`sonnet`, `opus`,
 * `haiku`) and the full ids, including their `[1m]`-suffixed long-context
 * variants.
 */
export const CONTEXT_WINDOWS: Record<string, number> = {
  sonnet: 200_000,
  opus: 200_000,
  haiku: 200_000,
  'claude-sonnet-5': 200_000,
  'claude-opus-5-5': 200_000,
  'claude-opus-5': 200_000,
  'claude-haiku-5-5': 200_000,
  'claude-sonnet-5[1m]': 1_000_000,
  'claude-opus-5-5[1m]': 1_000_000,
  'claude-opus-5[1m]': 1_000_000,
}

/** Conservative fallback for a model id not in `CONTEXT_WINDOWS`. */
export const DEFAULT_CONTEXT_WINDOW = 200_000

/** Default fraction of a run's context window that raises a warning. */
export const DEFAULT_CONTEXT_WARN_PCT = 0.85

export function contextWindowFor(model: string): number {
  return CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW
}
