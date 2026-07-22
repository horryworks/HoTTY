/**
 * Conversation color-coding for AI Chat multi-watch.
 *
 * Each AI Chat conversation (a `ChatTab`) is assigned one of a fixed palette of
 * distinct colors, derived from its stable `ordinal` (the same monotonic counter
 * that backs the "Tab N" fallback title) — so a conversation keeps its color as
 * other conversations open/close, with NO extra stored state. The color is used
 * to paint the conversation's watched terminal tabs, its own conversation tab,
 * and its header chips the same hue, making the terminal↔conversation ownership
 * legible at a glance.
 *
 * The palette REUSES the existing themeable `--pane-color-1..6` variables. They
 * are defined in every theme JSON and are editable in the Custom Theme Creator,
 * but had no live consumer — so conversation coloring adopts them rather than
 * introducing a new palette (see `CustomThemeCreator` VAR_DESCRIPTIONS, which
 * document this usage). This module is the ONLY place the `pane-color` key name
 * is referenced, so the palette can be renamed here alone if desired.
 */

/** Number of distinct conversation colors before the palette repeats. */
export const CONVERSATION_COLOR_COUNT = 6;

/**
 * Map a conversation's `ordinal` (1-based, monotonic) to a palette slot [0, 5].
 * Defensive against 0/negative ordinals (falls back into range).
 */
export function conversationColorIndex(ordinal: number): number {
  const n = Number.isFinite(ordinal) ? Math.trunc(ordinal) : 1;
  return (((n - 1) % CONVERSATION_COLOR_COUNT) + CONVERSATION_COLOR_COUNT) % CONVERSATION_COLOR_COUNT;
}

/** CSS `var(...)` reference for a palette slot, e.g. 0 → `var(--pane-color-1)`. */
export function conversationColorVar(colorIndex: number): string {
  const n = Number.isFinite(colorIndex) ? Math.trunc(colorIndex) : 0;
  const slot = (((n % CONVERSATION_COLOR_COUNT) + CONVERSATION_COLOR_COUNT) % CONVERSATION_COLOR_COUNT);
  return `var(--pane-color-${slot + 1})`;
}
