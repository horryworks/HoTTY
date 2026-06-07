import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decideAutoExec, _clearVerdictCache, type DecideOptions } from './aiCommandClassifier';
import { DEFAULT_WHITELIST, DEFAULT_BLACKLIST } from './commandLists';
import { tauriService } from '../services/tauriService';

vi.mock('../services/tauriService', () => ({
    tauriService: {
        aiClassifyCommand: vi.fn(),
    },
}));

const mockClassify = vi.mocked(tauriService.aiClassifyCommand);

const baseOpts = (overrides: Partial<DecideOptions> = {}): DecideOptions => ({
    strategy: 'hybrid',
    model: 'gemini-2.0-flash',
    providerId: 'gemini',
    whitelist: DEFAULT_WHITELIST,
    blacklist: DEFAULT_BLACKLIST,
    confidenceThreshold: 0.7,
    ...overrides,
});

beforeEach(() => {
    _clearVerdictCache();
    mockClassify.mockReset();
});

describe('decideAutoExec', () => {
    describe('blacklist (checked first, all strategies)', () => {
        it('blocks a blacklisted command before any AI call (hybrid)', async () => {
            const d = await decideAutoExec('sudo rm -rf /', baseOpts());
            expect(d.source).toBe('blacklist');
            expect(d.autoExec).toBe(false);
            expect(mockClassify).not.toHaveBeenCalled();
        });

        it('blocks in ai strategy too', async () => {
            const d = await decideAutoExec('mkfs.ext4 /dev/sda1', baseOpts({ strategy: 'ai' }));
            expect(d.source).toBe('blacklist');
            expect(mockClassify).not.toHaveBeenCalled();
        });

        it('a custom blacklist entry wins over the whitelist', async () => {
            // `docker` would otherwise reach the AI; blacklisting it → ask.
            const d = await decideAutoExec('docker ps', baseOpts({ blacklist: ['docker'] }));
            expect(d.source).toBe('blacklist');
            expect(d.autoExec).toBe(false);
            expect(mockClassify).not.toHaveBeenCalled();
        });
    });

    describe('whitelist', () => {
        it('auto-executes whitelisted read-only commands without AI (hybrid)', async () => {
            const d = await decideAutoExec('show version', baseOpts());
            expect(d.source).toBe('whitelist');
            expect(d.autoExec).toBe(true);
            expect(mockClassify).not.toHaveBeenCalled();
        });

        it('static strategy: whitelisted → auto', async () => {
            const d = await decideAutoExec('ls -la', baseOpts({ strategy: 'static' }));
            expect(d.source).toBe('whitelist');
            expect(d.autoExec).toBe(true);
            expect(mockClassify).not.toHaveBeenCalled();
        });

        it('static strategy: not whitelisted → ask (no AI)', async () => {
            const d = await decideAutoExec('frobnicate --all', baseOpts({ strategy: 'static' }));
            expect(d.source).toBe('ask');
            expect(d.autoExec).toBe(false);
            expect(mockClassify).not.toHaveBeenCalled();
        });
    });

    describe('AI judgment (gray zone)', () => {
        it('auto-executes when AI says read-only with high confidence', async () => {
            mockClassify.mockResolvedValue({ modifiesState: false, confidence: 0.9, reason: 'reads only' });
            const d = await decideAutoExec('some-tool --status', baseOpts());
            expect(d.source).toBe('ai');
            expect(d.autoExec).toBe(true);
            expect(d.confidence).toBe(0.9);
            expect(mockClassify).toHaveBeenCalledOnce();
        });

        it('asks when AI says it modifies state', async () => {
            mockClassify.mockResolvedValue({ modifiesState: true, confidence: 0.95, reason: 'writes data' });
            const d = await decideAutoExec('some-tool --apply', baseOpts());
            expect(d.source).toBe('ai');
            expect(d.autoExec).toBe(false);
            expect(d.reason).toBe('writes data');
        });

        it('asks when confidence is below threshold', async () => {
            mockClassify.mockResolvedValue({ modifiesState: false, confidence: 0.4, reason: 'unsure' });
            const d = await decideAutoExec('some-tool --maybe', baseOpts());
            expect(d.source).toBe('ai');
            expect(d.autoExec).toBe(false);
        });

        it('ai strategy bypasses the whitelist fast-path', async () => {
            mockClassify.mockResolvedValue({ modifiesState: false, confidence: 0.99, reason: 'read-only' });
            const d = await decideAutoExec('show version', baseOpts({ strategy: 'ai' }));
            expect(d.source).toBe('ai');
            expect(mockClassify).toHaveBeenCalledOnce();
        });
    });

    describe('fallback on failure', () => {
        it('falls back to manual when the AI call throws', async () => {
            mockClassify.mockRejectedValue(new Error('classification timed out'));
            const d = await decideAutoExec('some-tool --status', baseOpts());
            expect(d.source).toBe('fallback');
            expect(d.autoExec).toBe(false);
            expect(d.reason).toContain('timed out');
        });
    });

    describe('caching', () => {
        it('reuses a cached verdict for the same command (no second AI call)', async () => {
            mockClassify.mockResolvedValue({ modifiesState: false, confidence: 0.9, reason: 'reads only' });
            await decideAutoExec('some-tool --status', baseOpts());
            await decideAutoExec('some-tool   --status', baseOpts()); // normalized to same key
            expect(mockClassify).toHaveBeenCalledOnce();
        });

        it('does not reuse across different providers', async () => {
            mockClassify.mockResolvedValue({ modifiesState: false, confidence: 0.9, reason: 'reads only' });
            await decideAutoExec('some-tool --status', baseOpts({ providerId: 'gemini' }));
            await decideAutoExec('some-tool --status', baseOpts({ providerId: 'openai' }));
            expect(mockClassify).toHaveBeenCalledTimes(2);
        });
    });
});
