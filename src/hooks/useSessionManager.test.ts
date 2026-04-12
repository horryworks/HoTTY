import { describe, it, expect, vi } from 'vitest';
import { handleTerminalKey, type TerminalKeyHooks } from './useSessionManager';

function makeTerm(selection: string) {
  const clearSelection = vi.fn();
  const term: TerminalKeyHooks = {
    getSelection: () => selection,
    clearSelection,
  };
  return { term, clearSelection };
}

function makeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    type: 'keydown',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    key: '',
    ...overrides,
  } as KeyboardEvent;
}

describe('handleTerminalKey', () => {
  it('Ctrl+V calls onPaste and suppresses xterm default', () => {
    const onPaste = vi.fn();
    const { term } = makeTerm('');
    const r = handleTerminalKey(makeEvent({ ctrlKey: true, key: 'v' }), term, onPaste);
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(r).toBe(false);
  });

  it('Ctrl+C with selection clears the selection and suppresses SIGINT', () => {
    const onPaste = vi.fn();
    const { term, clearSelection } = makeTerm('selected text');
    const r = handleTerminalKey(makeEvent({ ctrlKey: true, key: 'c' }), term, onPaste);
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(onPaste).not.toHaveBeenCalled();
    expect(r).toBe(false);
  });

  it('Ctrl+C without selection passes through', () => {
    const onPaste = vi.fn();
    const { term, clearSelection } = makeTerm('');
    const r = handleTerminalKey(makeEvent({ ctrlKey: true, key: 'c' }), term, onPaste);
    expect(clearSelection).not.toHaveBeenCalled();
    expect(r).toBe(true);
  });

  it('ignores keyup events', () => {
    const onPaste = vi.fn();
    const { term } = makeTerm('');
    const r = handleTerminalKey(
      makeEvent({ type: 'keyup', ctrlKey: true, key: 'v' }),
      term,
      onPaste
    );
    expect(onPaste).not.toHaveBeenCalled();
    expect(r).toBe(true);
  });

  it('ignores Ctrl+Shift+V (passes through)', () => {
    const onPaste = vi.fn();
    const { term } = makeTerm('');
    const r = handleTerminalKey(
      makeEvent({ ctrlKey: true, shiftKey: true, key: 'V' }),
      term,
      onPaste
    );
    expect(onPaste).not.toHaveBeenCalled();
    expect(r).toBe(true);
  });

  it('passes through unrelated keys', () => {
    const onPaste = vi.fn();
    const { term } = makeTerm('');
    const r = handleTerminalKey(makeEvent({ key: 'a' }), term, onPaste);
    expect(r).toBe(true);
  });
});
