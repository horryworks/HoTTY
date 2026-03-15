/**
 * Gemini API pricing (USD per 1M tokens).
 * Source: https://ai.google.dev/pricing
 * Update this table when Google changes pricing.
 *
 * Keys are matched as prefixes against the model name (longest match wins),
 * so e.g. "gemini-2.0-flash-exp" is matched before "gemini-2.0-flash".
 */
export interface ModelPricing {
    input: number;
    output: number;
}

export const GEMINI_PRICING: Record<string, ModelPricing> = {
    'gemini-2.5-pro':        { input: 1.25,   output: 10.00 },
    'gemini-2.0-flash-exp':  { input: 0,       output: 0     },
    'gemini-2.0-flash-lite': { input: 0.075,   output: 0.30  },
    'gemini-2.0-flash':      { input: 0.10,    output: 0.40  },
    'gemini-1.5-pro':        { input: 1.25,    output: 5.00  },
    'gemini-1.5-flash-8b':   { input: 0.0375,  output: 0.15  },
    'gemini-1.5-flash':      { input: 0.075,   output: 0.30  },
};

/** Fallback rate used when no prefix matches. */
export const GEMINI_PRICING_FALLBACK: ModelPricing = { input: 0.075, output: 0.30 };

/**
 * Returns the USD cost for the given token counts and model name.
 * Uses longest-prefix match against GEMINI_PRICING.
 */
export function calcGeminiCost(inputTokens: number, outputTokens: number, model: string): number {
    const key = Object.keys(GEMINI_PRICING)
        .sort((a, b) => b.length - a.length)
        .find(k => model.startsWith(k));
    const rate = key ? GEMINI_PRICING[key] : GEMINI_PRICING_FALLBACK;
    return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}
