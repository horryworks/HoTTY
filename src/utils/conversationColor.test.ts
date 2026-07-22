import { describe, it, expect } from 'vitest';
import {
  CONVERSATION_COLOR_COUNT,
  conversationColorIndex,
  conversationColorVar,
} from './conversationColor';

describe('conversationColorIndex', () => {
  it('maps the first six ordinals to slots 0..5', () => {
    expect([1, 2, 3, 4, 5, 6].map(conversationColorIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('cycles back to slot 0 at ordinal 7 (palette repeats)', () => {
    expect(conversationColorIndex(7)).toBe(0);
    expect(conversationColorIndex(8)).toBe(1);
    expect(conversationColorIndex(12)).toBe(5);
    expect(conversationColorIndex(13)).toBe(0);
  });

  it('clamps defensive/out-of-range ordinals into [0,5]', () => {
    expect(conversationColorIndex(0)).toBe(5);
    expect(conversationColorIndex(-1)).toBe(4);
    expect(conversationColorIndex(1.9)).toBe(0); // truncated to 1
    expect(conversationColorIndex(NaN)).toBe(0); // falls back to ordinal 1
  });
});

describe('conversationColorVar', () => {
  it('references the matching --pane-color-N (1-based)', () => {
    expect(conversationColorVar(0)).toBe('var(--pane-color-1)');
    expect(conversationColorVar(5)).toBe('var(--pane-color-6)');
  });

  it('wraps color indices beyond the palette size', () => {
    expect(conversationColorVar(CONVERSATION_COLOR_COUNT)).toBe('var(--pane-color-1)');
    expect(conversationColorVar(7)).toBe('var(--pane-color-2)');
    expect(conversationColorVar(-1)).toBe('var(--pane-color-6)');
  });

  it('composes with conversationColorIndex for an end-to-end ordinal→var map', () => {
    expect(conversationColorVar(conversationColorIndex(1))).toBe('var(--pane-color-1)');
    expect(conversationColorVar(conversationColorIndex(7))).toBe('var(--pane-color-1)');
  });
});
