import { describe, it, expect } from 'vitest';
import { segmentMessageContent, extractExecuteCommands, type ContentPart } from './executeBlockUtils';

// Triple-backtick fence, kept in a constant to avoid backtick juggling in test strings.
const F = '```';

describe('segmentMessageContent', () => {
    it('recognizes a closed ```execute block and preserves the command verbatim', () => {
        const content = `${F}execute\nreturn\nsave\ny\n${F}`;
        const parts = segmentMessageContent(content);
        const exec = parts.find((p) => p.kind === 'execute') as Extract<ContentPart, { kind: 'execute' }>;
        expect(exec).toBeDefined();
        expect(exec.command).toBe('return\nsave\ny'); // regression for the reported Huawei USG payload
    });

    it('strips an `execute ` prefix from plain / bash / sh / shell fences', () => {
        for (const lang of ['', 'bash', 'sh', 'shell']) {
            const content = `${F}${lang}\nexecute\nreturn\nsave\n${F}`;
            const exec = segmentMessageContent(content).find((p) => p.kind === 'execute') as
                Extract<ContentPart, { kind: 'execute' }>;
            expect(exec, `lang=${lang}`).toBeDefined();
            expect(exec.command).toBe('return\nsave');
        }
    });

    it('treats a non-execute code fence as markdown', () => {
        const content = `${F}js\nconst x = 1;\n${F}`;
        const parts = segmentMessageContent(content);
        expect(parts.some((p) => p.kind === 'execute' || p.kind === 'execute-pending')).toBe(false);
        expect(parts.some((p) => p.kind === 'markdown')).toBe(true);
    });

    it('assigns -exec keys to execute parts and -md keys to markdown parts', () => {
        const content = `intro\n\n${F}execute\nls\n${F}\n\noutro`;
        const parts = segmentMessageContent(content);
        for (const p of parts) {
            if (p.kind === 'execute' || p.kind === 'execute-pending') {
                expect(p.key.endsWith('-exec')).toBe(true);
            } else {
                expect(p.key.endsWith('-md')).toBe(true);
            }
        }
    });

    it('changes the key at an index when a part flips kind (markdown -> execute)', () => {
        // Same content position, two streaming frames: text-only vs an execute fence.
        const md = segmentMessageContent('return');
        const exec = segmentMessageContent(`${F}execute\nreturn\n${F}`);
        const mdKey = md.find((p) => p.kind === 'markdown')?.key;
        const execKey = exec.find((p) => p.kind === 'execute')?.key;
        expect(mdKey).toBeDefined();
        expect(execKey).toBeDefined();
        expect(mdKey).not.toBe(execKey); // -> React remounts, no stale innerHTML DOM survives
    });

    describe('streaming tail (unclosed fence)', () => {
        it('renders a trailing unclosed ```execute fence as execute-pending', () => {
            const content = `${F}execute\nreturn\nsave`;
            const parts = segmentMessageContent(content);
            const pending = parts.find((p) => p.kind === 'execute-pending') as
                Extract<ContentPart, { kind: 'execute-pending' }>;
            expect(pending).toBeDefined();
            expect(pending.command).toBe('return\nsave');
        });

        it('uses the same -exec key for pending and the eventual closed block (in-place update)', () => {
            const pendingKey = segmentMessageContent(`${F}execute\nreturn\nsave`)
                .find((p) => p.kind === 'execute-pending')?.key;
            const closedKey = segmentMessageContent(`${F}execute\nreturn\nsave\ny\n${F}`)
                .find((p) => p.kind === 'execute')?.key;
            expect(pendingKey).toBeDefined();
            expect(pendingKey).toBe(closedKey); // no remount -> no layout jump on close
        });

        it('emits prose before an unclosed fence as a separate markdown part', () => {
            const content = `Here is the fix.\n\n${F}execute\nreturn`;
            const parts = segmentMessageContent(content);
            expect(parts[0].kind).toBe('markdown');
            expect((parts[0] as Extract<ContentPart, { kind: 'markdown' }>).text).toContain('Here is the fix.');
            expect(parts.some((p) => p.kind === 'execute-pending')).toBe(true);
        });

        it('leaves a non-execute unclosed fence as markdown', () => {
            for (const opener of [`${F}bash\nls -la`, `${F}text\nhello`]) {
                const parts = segmentMessageContent(opener);
                expect(parts.some((p) => p.kind === 'execute-pending')).toBe(false);
                expect(parts.every((p) => p.kind === 'markdown')).toBe(true);
            }
        });
    });
});

describe('extractExecuteCommands', () => {
    it('returns an empty list when there are no execute blocks', () => {
        expect(extractExecuteCommands('just some prose')).toEqual([]);
        expect(extractExecuteCommands(`${F}js\nconst x = 1;\n${F}`)).toEqual([]);
    });

    it('returns each completed execute command in order', () => {
        const content = `${F}execute\nls\n${F}\n\ntext\n\n${F}execute\npwd\n${F}`;
        expect(extractExecuteCommands(content)).toEqual(['ls', 'pwd']);
    });

    it('excludes pending (unclosed) execute blocks', () => {
        const content = `${F}execute\nls\n${F}\n\n${F}execute\npwd`; // second fence not closed
        expect(extractExecuteCommands(content)).toEqual(['ls']);
    });
});
