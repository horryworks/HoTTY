/**
 * AI model pricing (USD per 1M tokens).
 * Sources:
 *   - Gemini:    https://ai.google.dev/pricing
 *   - OpenAI:    https://openai.com/api/pricing/
 *   - Anthropic: https://www.anthropic.com/pricing
 *
 * Keys are matched as prefixes against the model name (longest match wins),
 * so e.g. "gemini-2.0-flash-exp" is matched before "gemini-2.0-flash".
 *
 * Update these tables when providers change pricing.
 */
export interface ModelPricing {
    input: number;
    output: number;
}

export const GEMINI_PRICING: Record<string, ModelPricing> = {
    // 3.1
    'gemini-3.1-pro':            { input: 2.00,   output: 12.00 },
    'gemini-3.1-flash-lite':     { input: 0.25,   output: 1.50  },
    // 3.0
    'gemini-3-pro':              { input: 2.00,   output: 12.00 },
    'gemini-3-flash':            { input: 0.50,   output: 3.00  },
    // 2.5
    'gemini-2.5-pro':            { input: 1.25,   output: 10.00 },
    'gemini-2.5-flash-lite':     { input: 0.10,   output: 0.40  },
    'gemini-2.5-flash':          { input: 0.30,   output: 2.50  },
    // 2.0
    'gemini-2.0-flash-exp':      { input: 0,      output: 0     },
    'gemini-2.0-flash-lite':     { input: 0.075,  output: 0.30  },
    'gemini-2.0-flash':          { input: 0.10,   output: 0.40  },
    // 1.5
    'gemini-1.5-pro':            { input: 1.25,   output: 5.00  },
    'gemini-1.5-flash-8b':       { input: 0.0375, output: 0.15  },
    'gemini-1.5-flash':          { input: 0.075,  output: 0.30  },
};

export const OPENAI_PRICING: Record<string, ModelPricing> = {
    'gpt-4.1':              { input: 2.00,   output: 8.00  },
    'gpt-4.1-mini':         { input: 0.40,   output: 1.60  },
    'gpt-4.1-nano':         { input: 0.10,   output: 0.40  },
    'gpt-4o-mini':          { input: 0.15,   output: 0.60  },
    'gpt-4o':               { input: 2.50,   output: 10.00 },
    'gpt-4-turbo':          { input: 10.00,  output: 30.00 },
    'gpt-3.5-turbo':        { input: 0.50,   output: 1.50  },
    'o4-mini':              { input: 1.10,   output: 4.40  },
    'o3-mini':              { input: 1.10,   output: 4.40  },
    'o3':                   { input: 2.00,   output: 8.00  },
    'o1-mini':              { input: 1.10,   output: 4.40  },
    'o1':                   { input: 15.00,  output: 60.00 },
};

export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
    'claude-opus-4':        { input: 15.00,  output: 75.00 },
    'claude-sonnet-4':      { input: 3.00,   output: 15.00 },
    'claude-haiku-4':       { input: 0.80,   output: 4.00  },
    'claude-3.5-sonnet':    { input: 3.00,   output: 15.00 },
    'claude-3.5-haiku':     { input: 0.80,   output: 4.00  },
    'claude-3-opus':        { input: 15.00,  output: 75.00 },
    'claude-3-sonnet':      { input: 3.00,   output: 15.00 },
    'claude-3-haiku':       { input: 0.25,   output: 1.25  },
};

const ALL_PRICING: Record<string, ModelPricing> = {
    ...GEMINI_PRICING,
    ...OPENAI_PRICING,
    ...ANTHROPIC_PRICING,
};

/** Sorted keys for longest-prefix match (computed once). */
const SORTED_KEYS = Object.keys(ALL_PRICING).sort((a, b) => b.length - a.length);

/**
 * Returns the USD cost for the given token counts and model name,
 * or null if the model is not in any pricing table.
 * Uses longest-prefix match across all providers.
 */
export function calcAICost(inputTokens: number, outputTokens: number, model: string): number | null {
    // Normalize Vertex AI paths like "publishers/google/models/gemini-3.1-pro-preview"
    const shortModel = model.includes('/') ? model.split('/').pop()! : model;
    const key = SORTED_KEYS.find(k => shortModel.startsWith(k));
    if (!key) return null;
    const rate = ALL_PRICING[key];
    return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}
