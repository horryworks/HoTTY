import { describe, it, expect } from 'vitest';
import { TERMINAL_SEQUENCES } from './terminalSequences';

describe('TERMINAL_SEQUENCES', () => {
    it('LINE_WRAP_ENABLED has the correct ANSI escape sequence value', () => {
        expect(TERMINAL_SEQUENCES.LINE_WRAP_ENABLED).toBe('\x1b[?7h');
    });

    it('LINE_WRAP_DISABLED has the correct ANSI escape sequence value', () => {
        expect(TERMINAL_SEQUENCES.LINE_WRAP_DISABLED).toBe('\x1b[?7l');
    });

    it('LINE_WRAP_ENABLED is a string', () => {
        expect(typeof TERMINAL_SEQUENCES.LINE_WRAP_ENABLED).toBe('string');
    });

    it('LINE_WRAP_DISABLED is a string', () => {
        expect(typeof TERMINAL_SEQUENCES.LINE_WRAP_DISABLED).toBe('string');
    });

    it('LINE_WRAP_ENABLED and LINE_WRAP_DISABLED are different from each other', () => {
        expect(TERMINAL_SEQUENCES.LINE_WRAP_ENABLED).not.toBe(TERMINAL_SEQUENCES.LINE_WRAP_DISABLED);
    });

    it('TERMINAL_SEQUENCES has exactly 2 keys', () => {
        expect(Object.keys(TERMINAL_SEQUENCES)).toHaveLength(2);
    });
});
