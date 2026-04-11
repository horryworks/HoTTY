import { describe, it, expect } from 'vitest';
import { buildExecutionRules } from './aiPrompts';

describe('buildExecutionRules', () => {
    it('returns a non-empty string', () => {
        const result = buildExecutionRules();
        expect(result).toBeTruthy();
        expect(result.length).toBeGreaterThan(0);
    });

    it('contains the ABSOLUTE MANDATORY RULES header', () => {
        const result = buildExecutionRules();
        expect(result).toContain('[ABSOLUTE MANDATORY RULES - NO EXCEPTIONS]');
    });

    it('contains all 7 mandatory rules', () => {
        const result = buildExecutionRules();
        expect(result).toContain('1. Answer ONLY what the user asked');
        expect(result).toContain('2. After answering, STOP');
        expect(result).toContain('3. ANY shell/terminal command MUST be placed in EXACTLY ONE');
        expect(result).toContain('4. It is STRICTLY FORBIDDEN to use more than one');
        expect(result).toContain('5. It is STRICTLY FORBIDDEN to write commands as inline code');
        expect(result).toContain('6. If multiple steps are needed');
        expect(result).toContain('7. Breaking these rules causes a critical application failure');
    });

    it('contains the proactive investigation instruction', () => {
        const result = buildExecutionRules();
        expect(result).toContain('proactively suggest terminal commands');
        expect(result).toContain('```execute');
    });

    it('prohibits && and ; chaining in rule 6', () => {
        const result = buildExecutionRules();
        expect(result).toContain('NEVER use && or ; to chain commands on one line');
    });
});
