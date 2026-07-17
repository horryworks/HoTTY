import { describe, it, expect } from 'vitest';
import { TERMINAL_SEQUENCES } from './terminalSequences';

describe('TERMINAL_SEQUENCES', () => {
  it('LINE_WRAP_ENABLED enables DECAWM autowrap and reverse-wraparound', () => {
    // ?7h autowrap + ?45h reverse-wraparound. ?45 lets a backspace at column 0
    // of a soft-wrapped line climb to the end of the previous line, which network
    // devices (Huawei VRP / Cisco) rely on when editing a wrapped command line.
    expect(TERMINAL_SEQUENCES.LINE_WRAP_ENABLED).toBe('\x1b[?7h\x1b[?45h');
  });

  it('LINE_WRAP_DISABLED disables DECAWM autowrap and reverse-wraparound', () => {
    expect(TERMINAL_SEQUENCES.LINE_WRAP_DISABLED).toBe('\x1b[?7l\x1b[?45l');
  });

  it('LINE_WRAP_ENABLED includes the reverse-wraparound enable', () => {
    expect(TERMINAL_SEQUENCES.LINE_WRAP_ENABLED).toContain('\x1b[?45h');
  });

  it('LINE_WRAP_ENABLED and LINE_WRAP_DISABLED are different', () => {
    expect(TERMINAL_SEQUENCES.LINE_WRAP_ENABLED).not.toBe(TERMINAL_SEQUENCES.LINE_WRAP_DISABLED);
  });
});
