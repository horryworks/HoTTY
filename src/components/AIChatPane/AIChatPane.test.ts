import { describe, it, expect } from 'vitest';
import { calcAICost } from '../../constants/aiPricing';
import { sanitizeHtml } from '../../utils/htmlUtils';
import { extractExecuteCommands } from './extractExecuteCommands';

describe('calcAICost', () => {
    it('returns 0 for zero tokens', () => {
        expect(calcAICost(0, 0, 'gemini-1.5-flash')).toBe(0);
    });

    it('calculates cost for gemini-1.5-flash', () => {
        // 1M input at $0.075 + 1M output at $0.30 = $0.375
        expect(calcAICost(1_000_000, 1_000_000, 'gemini-1.5-flash')).toBeCloseTo(0.375);
    });

    it('calculates cost for gemini-1.5-pro', () => {
        // 1M input at $1.25 + 1M output at $5.00 = $6.25
        expect(calcAICost(1_000_000, 1_000_000, 'gemini-1.5-pro')).toBeCloseTo(6.25);
    });

    it('calculates cost for gemini-2.0-flash', () => {
        // 1M input at $0.10 + 1M output at $0.40 = $0.50
        expect(calcAICost(1_000_000, 1_000_000, 'gemini-2.0-flash')).toBeCloseTo(0.50);
    });

    it('returns 0 for free experimental model', () => {
        expect(calcAICost(1_000_000, 1_000_000, 'gemini-2.0-flash-exp')).toBe(0);
    });

    it('matches on model name prefix (e.g. versioned suffix)', () => {
        // gemini-2.0-flash-001 should match gemini-2.0-flash
        expect(calcAICost(1_000_000, 1_000_000, 'gemini-2.0-flash-001')).toBeCloseTo(0.50);
    });

    it('returns null for unknown model', () => {
        expect(calcAICost(1_000_000, 1_000_000, 'unknown-model')).toBeNull();
    });

    it('calculates cost for OpenAI gpt-4o', () => {
        expect(calcAICost(1_000_000, 1_000_000, 'gpt-4o')).toBeCloseTo(12.50);
    });

    it('calculates cost for Anthropic claude-sonnet-4', () => {
        expect(calcAICost(1_000_000, 1_000_000, 'claude-sonnet-4-6')).toBeCloseTo(18.00);
    });
});

describe('sanitizeHtml', () => {
    it('removes <script> tags', () => {
        const result = sanitizeHtml('<p>hello</p><script>alert(1)</script>');
        expect(result).not.toContain('<script');
        expect(result).toContain('hello');
    });

    it('removes <style> tags (CSS injection prevention)', () => {
        const result = sanitizeHtml('<p>hi</p><style>@import "javascript:alert(1)"</style>');
        expect(result).not.toContain('<style');
        expect(result).not.toContain('@import');
    });

    it('removes inline event handlers', () => {
        const result = sanitizeHtml('<p onclick="alert(1)">click</p>');
        expect(result).not.toContain('onclick');
    });

    it('removes javascript: href', () => {
        const result = sanitizeHtml('<a href="javascript:alert(1)">link</a>');
        expect(result).not.toContain('javascript:');
    });

    it('removes data: src', () => {
        const result = sanitizeHtml('<img src="data:text/html,<script>alert(1)</script>">');
        expect(result).not.toMatch(/src\s*=\s*["']data:/i);
    });

    it('removes <iframe> tags', () => {
        const result = sanitizeHtml('<iframe src="https://evil.com"></iframe>');
        expect(result).not.toContain('<iframe');
    });

    it('preserves safe HTML', () => {
        const result = sanitizeHtml('<p><strong>hello</strong> <a href="https://example.com">link</a></p>');
        expect(result).toContain('<strong>hello</strong>');
        expect(result).toContain('href="https://example.com"');
    });
});

describe('extractExecuteCommands', () => {
    it('returns an empty array when no code blocks are present', () => {
        expect(extractExecuteCommands('just some prose, no code')).toEqual([]);
    });

    it('extracts a single command from an ```execute block', () => {
        const content = 'Run this:\n```execute\nls -la\n```\nDone.';
        expect(extractExecuteCommands(content)).toEqual(['ls -la']);
    });

    it('extracts multiple commands from separate ```execute blocks', () => {
        const content =
            '```execute\necho hello\n```\n' +
            'text in between\n' +
            '```execute\necho world\n```';
        expect(extractExecuteCommands(content)).toEqual(['echo hello', 'echo world']);
    });

    it('preserves multi-line commands inside one block', () => {
        const content = '```execute\nls\npwd\nwhoami\n```';
        expect(extractExecuteCommands(content)).toEqual(['ls\npwd\nwhoami']);
    });

    it('extracts from an unlabeled block when the body starts with "execute "', () => {
        const content = '```\nexecute ls -la\n```';
        expect(extractExecuteCommands(content)).toEqual(['ls -la']);
    });

    it('extracts from an unlabeled block when the body starts with "execute\\n"', () => {
        const content = '```\nexecute\nls -la\n```';
        expect(extractExecuteCommands(content)).toEqual(['ls -la']);
    });

    it('extracts from a bash-labeled block that starts with "execute"', () => {
        const content = '```bash\nexecute systemctl status sshd\n```';
        expect(extractExecuteCommands(content)).toEqual(['systemctl status sshd']);
    });

    it('extracts from sh/shell-labeled blocks that start with "execute"', () => {
        expect(extractExecuteCommands('```sh\nexecute uname -a\n```')).toEqual(['uname -a']);
        expect(extractExecuteCommands('```shell\nexecute uptime\n```')).toEqual(['uptime']);
    });

    it('ignores plain bash blocks that do not start with "execute"', () => {
        expect(extractExecuteCommands('```bash\nrm -rf /\n```')).toEqual([]);
    });

    it('ignores unrelated languages like python and javascript', () => {
        const content = '```python\nprint("hello")\n```\n```javascript\nconsole.log(1)\n```';
        expect(extractExecuteCommands(content)).toEqual([]);
    });

    it('handles fences with 4+ backticks', () => {
        expect(extractExecuteCommands('````execute\nls\n````')).toEqual(['ls']);
    });

    it('trims surrounding whitespace inside the block', () => {
        expect(extractExecuteCommands('```execute\n   ls -la   \n```')).toEqual(['ls -la']);
    });

    it('is case-insensitive on the language tag', () => {
        expect(extractExecuteCommands('```EXECUTE\nls\n```')).toEqual(['ls']);
        expect(extractExecuteCommands('```Execute\nls\n```')).toEqual(['ls']);
    });

    it('handles an empty string input', () => {
        expect(extractExecuteCommands('')).toEqual([]);
    });

    it('does not crash on malformed / unclosed fences', () => {
        expect(() => extractExecuteCommands('```execute\nls -la\n')).not.toThrow();
        expect(extractExecuteCommands('```execute\nls -la\n')).toEqual([]);
    });
});
