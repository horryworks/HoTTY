import { describe, it, expect } from 'vitest';
import { TERMINAL_SEQUENCES } from './terminalSequences';

describe('TERMINAL_SEQUENCES', () => {
  it('LINE_WRAP_ENABLED is the DECAWM enable sequence', () => {
    expect(TERMINAL_SEQUENCES.LINE_WRAP_ENABLED).toBe('\x1b[?7h');
  });

  it('LINE_WRAP_DISABLED is the DECAWM disable sequence', () => {
    expect(TERMINAL_SEQUENCES.LINE_WRAP_DISABLED).toBe('\x1b[?7l');
  });

  it('LINE_WRAP_ENABLED and LINE_WRAP_DISABLED are different', () => {
    expect(TERMINAL_SEQUENCES.LINE_WRAP_ENABLED).not.toBe(TERMINAL_SEQUENCES.LINE_WRAP_DISABLED);
  });
});
