import { describe, it, expect, beforeEach } from 'vitest';
import {
    useAiWorkerSessionStore,
    isWorkerLive,
    workersForTab,
    workersForPane,
    idleWorkers,
    type AiWorkerSession,
} from './aiWorkerSessionStore';

const worker = (over: Partial<AiWorkerSession> & { id: string }): AiWorkerSession => ({
    key: `ssh:alice@192.0.2.10:22`,
    displayName: 'sw-01',
    protocol: 'ssh',
    host: '192.0.2.10',
    port: 22,
    username: 'alice',
    status: 'connecting',
    paneId: 'ai-1',
    tabId: 't1',
    openedAt: 1000,
    lastUsedAt: 1000,
    manualLogin: false,
    ...over,
});

beforeEach(() => {
    useAiWorkerSessionStore.getState().clear();
});

describe('aiWorkerSessionStore', () => {
    it('upserts, updates status, touches and removes', () => {
        const st = useAiWorkerSessionStore.getState();
        st.upsert(worker({ id: 'h-1' }));
        expect(useAiWorkerSessionStore.getState().workers['h-1'].status).toBe('connecting');

        st.setStatus('h-1', 'connected');
        expect(useAiWorkerSessionStore.getState().workers['h-1'].status).toBe('connected');

        st.setStatus('h-1', 'error', 'Connection refused');
        expect(useAiWorkerSessionStore.getState().workers['h-1']).toMatchObject({ status: 'error', errorMessage: 'Connection refused' });

        st.touch('h-1', 5000);
        expect(useAiWorkerSessionStore.getState().workers['h-1'].lastUsedAt).toBe(5000);

        st.remove('h-1');
        expect(useAiWorkerSessionStore.getState().workers['h-1']).toBeUndefined();
    });

    it('is reference-stable for no-op updates', () => {
        const st = useAiWorkerSessionStore.getState();
        st.upsert(worker({ id: 'h-1', status: 'connected' }));
        const before = useAiWorkerSessionStore.getState().workers;
        st.setStatus('h-1', 'connected');
        st.setStatus('h-missing', 'connected');
        st.touch('h-missing');
        st.remove('h-missing');
        expect(useAiWorkerSessionStore.getState().workers).toBe(before);
    });

    it('selects by tab / pane and reports liveness', () => {
        const st = useAiWorkerSessionStore.getState();
        st.upsert(worker({ id: 'h-1', tabId: 't1' }));
        st.upsert(worker({ id: 'h-2', tabId: 't2', status: 'connected' }));
        st.upsert(worker({ id: 'h-3', paneId: 'ai-2', status: 'disconnected' }));
        const w = useAiWorkerSessionStore.getState().workers;
        expect(workersForTab(w, 'ai-1', 't1').map((x) => x.id)).toEqual(['h-1']);
        expect(workersForPane(w, 'ai-1').map((x) => x.id).sort()).toEqual(['h-1', 'h-2']);
        expect(isWorkerLive(w['h-1'])).toBe(true);
        expect(isWorkerLive(w['h-2'])).toBe(true);
        expect(isWorkerLive(w['h-3'])).toBe(false);
    });

    it('finds idle connected workers past the threshold, never when the threshold is 0', () => {
        const st = useAiWorkerSessionStore.getState();
        st.upsert(worker({ id: 'h-old', status: 'connected', lastUsedAt: 0 }));
        st.upsert(worker({ id: 'h-fresh', status: 'connected', lastUsedAt: 9_000 }));
        st.upsert(worker({ id: 'h-connecting', status: 'connecting', lastUsedAt: 0 }));
        const w = useAiWorkerSessionStore.getState().workers;
        expect(idleWorkers(w, 5_000, 10_000).map((x) => x.id)).toEqual(['h-old']);
        expect(idleWorkers(w, 0, 10_000)).toEqual([]);
    });
});
