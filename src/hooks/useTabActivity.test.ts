import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { SessionRecord } from './useSessionManager';

let emitData: ((p: { sessionId: string; data: string }) => void) | null = null;
vi.mock('../services/tauriService', () => ({
  tauriService: {
    onSessionData: vi.fn((cb: (p: { sessionId: string; data: string }) => void) => {
      emitData = cb;
      return Promise.resolve(() => { emitData = null; });
    }),
  },
}));

import { useTabActivity, countLines, lastMeaningfulLine, TAB_ACTIVITY_FLUSH_MS } from './useTabActivity';
import { useTabActivityStore } from '../stores/tabActivityStore';

/** A terminal whose buffer holds `rows`, cursor on the last one. */
function fakeTerm(rows: string[]): SessionRecord['term'] {
  return {
    buffer: {
      active: {
        baseY: 0,
        cursorY: rows.length - 1,
        getLine: (y: number) => (y < rows.length ? { translateToString: () => rows[y] } : undefined),
      },
    },
  } as unknown as SessionRecord['term'];
}

function session(id: string, rows: string[]): SessionRecord {
  return { id, term: fakeTerm(rows) } as unknown as SessionRecord;
}

describe('countLines', () => {
  it('counts newlines, and a chunk without one as a single line', () => {
    expect(countLines('a\nb\nc\n')).toBe(3);
    expect(countLines('partial')).toBe(1);
  });
});

describe('lastMeaningfulLine', () => {
  it('skips blank lines and a bare prompt', () => {
    expect(lastMeaningfulLine(fakeTerm(['%LINK-3-UPDOWN: Gi0 up', 'sw-01#', '']))).toBe('%LINK-3-UPDOWN: Gi0 up');
  });

  it('shows the prompt when nothing else is on screen', () => {
    expect(lastMeaningfulLine(fakeTerm(['', 'sw-01#']))).toBe('sw-01#');
  });

  it('skips prompts that contain spaces (PowerShell, bracketed bash)', () => {
    expect(lastMeaningfulLine(fakeTerm(['Done.', 'PS C:\\work dir>', '']))).toBe('Done.');
    expect(lastMeaningfulLine(fakeTerm(['Done.', '[alice@vm-01 ~]$']))).toBe('Done.');
  });

  it('keeps output that merely ends in a prompt character', () => {
    expect(lastMeaningfulLine(fakeTerm(['copying', '100%']))).toBe('100%');
    expect(lastMeaningfulLine(fakeTerm(['a', '-->']))).toBe('-->');
  });

  it('keeps a prompt that carries a command', () => {
    expect(lastMeaningfulLine(fakeTerm(['sw-01#show clock']))).toBe('sw-01#show clock');
  });
});

describe('useTabActivity', () => {
  const sessions = new Map<string, SessionRecord>([
    ['shown', session('shown', ['shown#'])],
    ['back', session('back', ['ping 192.0.2.1', '64 bytes from 192.0.2.1'])],
  ]);
  const getSession = (id: string | null) => (id ? sessions.get(id) : undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    useTabActivityStore.setState({ activity: {} });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function mount(visible: string[]) {
    const hook = renderHook(({ v }) => useTabActivity(v, getSession), { initialProps: { v: visible } });
    await act(async () => { await Promise.resolve(); });
    return hook;
  }

  it('counts only hidden sessions, and only when the batch is flushed', async () => {
    await mount(['shown']);
    act(() => {
      emitData!({ sessionId: 'shown', data: 'x\n' });
      emitData!({ sessionId: 'back', data: 'a\nb\n' });
      emitData!({ sessionId: 'unknown', data: 'z\n' });
    });
    expect(useTabActivityStore.getState().activity).toEqual({});

    act(() => { vi.advanceTimersByTime(TAB_ACTIVITY_FLUSH_MS); });
    expect(useTabActivityStore.getState().activity).toEqual({
      back: { lines: 2, lastLine: '64 bytes from 192.0.2.1' },
    });
  });

  it('adds up across batches', async () => {
    await mount([]);
    act(() => { emitData!({ sessionId: 'back', data: 'a\n' }); vi.advanceTimersByTime(TAB_ACTIVITY_FLUSH_MS); });
    act(() => { emitData!({ sessionId: 'back', data: 'b\nc\n' }); vi.advanceTimersByTime(TAB_ACTIVITY_FLUSH_MS); });
    expect(useTabActivityStore.getState().activity.back.lines).toBe(3);
  });

  it('forgets a tab once it is on screen again', async () => {
    const hook = await mount([]);
    act(() => { emitData!({ sessionId: 'back', data: 'a\n' }); vi.advanceTimersByTime(TAB_ACTIVITY_FLUSH_MS); });
    expect(useTabActivityStore.getState().activity.back).toBeDefined();
    hook.rerender({ v: ['back'] });
    expect(useTabActivityStore.getState().activity.back).toBeUndefined();
  });

  it('forgets a tab that was closed while hidden', async () => {
    await mount([]);
    useTabActivityStore.setState({ activity: { closed: { lines: 4, lastLine: 'x' } } });
    act(() => { vi.advanceTimersByTime(TAB_ACTIVITY_FLUSH_MS); });
    expect(useTabActivityStore.getState().activity.closed).toBeUndefined();
  });

  it('stops listening on unmount', async () => {
    const hook = await mount([]);
    hook.unmount();
    expect(emitData).toBeNull();
  });
});
