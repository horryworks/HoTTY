import { describe, it, expect } from 'vitest';
import type { AskAiCommand, PromptPattern, PersonaDefinition } from './appTypes';

describe('appTypes', () => {
    it('AskAiCommand has the expected shape', () => {
        const cmd: AskAiCommand = { id: '1', label: 'Test', promptTemplate: 'template' };
        expect(cmd).toHaveProperty('id');
        expect(cmd).toHaveProperty('label');
        expect(cmd).toHaveProperty('promptTemplate');
    });

    it('PromptPattern has the expected shape', () => {
        const pattern: PromptPattern = { id: '1', name: 'Test', pattern: '\\$' };
        expect(pattern).toHaveProperty('id');
        expect(pattern).toHaveProperty('name');
        expect(pattern).toHaveProperty('pattern');
    });

    it('PersonaDefinition has the expected shape', () => {
        const persona: PersonaDefinition = { id: '1', label: 'Helper', systemPrompt: 'You are helpful.', askAiCommands: [] };
        expect(persona).toHaveProperty('id');
        expect(persona).toHaveProperty('label');
        expect(persona).toHaveProperty('systemPrompt');
    });
});
