/**
 * AI model context-window sizes (input tokens a single request may carry).
 * Sources: the same provider pages as `aiPricing.ts`.
 *
 * Keys are matched as prefixes against the model name (longest match wins),
 * so "gpt-4o-mini" and "gpt-4o" both resolve without listing every snapshot.
 * A local server's window is whatever it was started with, so local models
 * are never looked up here.
 *
 * Update these tables when providers change limits.
 */
const CONTEXT_WINDOWS: Record<string, number> = {
    // Gemini
    'gemini-3':           1_048_576,
    'gemini-2.5':         1_048_576,
    'gemini-2.0':         1_048_576,
    'gemini-1.5-pro':     2_097_152,
    'gemini-1.5-flash':   1_048_576,
    // OpenAI
    'gpt-5':              400_000,
    'gpt-4.1':            1_047_576,
    'gpt-4o':             128_000,
    'gpt-4-turbo':        128_000,
    'gpt-3.5-turbo':      16_385,
    'o4-mini':            200_000,
    'o3':                 200_000,
    'o1-mini':            128_000,
    'o1':                 200_000,
    // Anthropic (every current Claude model takes 200K by default)
    'claude-':            200_000,
};

/** Sorted keys for longest-prefix match (computed once). */
const SORTED_KEYS = Object.keys(CONTEXT_WINDOWS).sort((a, b) => b.length - a.length);

/**
 * Returns the context window (tokens) for the given model name,
 * or null if the model is not in the table.
 */
export function getContextWindow(model: string): number | null {
    // Normalize Vertex AI paths like "publishers/google/models/gemini-3.1-pro-preview"
    const shortModel = model.includes('/') ? model.split('/').pop()! : model;
    const key = SORTED_KEYS.find(k => shortModel.startsWith(k));
    return key ? CONTEXT_WINDOWS[key] : null;
}
