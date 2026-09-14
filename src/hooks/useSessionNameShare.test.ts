import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Every effect in this hook starts with `if (!IS_TAURI) return;`, and in jsdom
// the real module resolves IS_TAURI to false — so without this mock the hook
// does literally nothing and every assertion below would pass vacuously.
vi.mock('../utils/windowLabel', () => ({
  IS_TAURI: true,
  WINDOW_LABEL: 'main',
  AI_WINDOW_PREFIX: 'win-ai-',
  IS_AI_CHAT_WINDOW: false,
}));

const tv = vi.hoisted(() => ({
  broadcastSharedChange: vi.fn(),
  onSharedStoreChanged: vi.fn(),
}));
vi.mock('../services/tauriService', () => ({ tauriService: tv }));

import { useSessionNameShare } from './useSessionNameShare';
import {
  buildSessionNames,
  remoteSessionName,
  resetSessionNames,
  SESSION_NAMES_CHANNEL,
} from '../utils/sessionNameShare';
import type { SessionRecord } from './useSessionManager';

type SharedChangeCb = (e: { channel: string; payload: string; origin: string }) => void;

let received: SharedChangeCb | undefined;
let unlisten: ReturnType<typeof vi.fn>;

/** A session with only the fields this hook and `sessionBindingKey` read. */
function session(id: string, displayName: string, host = '192.0.2.10'): SessionRecord {
  return {
    id,
    displayName,
    protocol: 'ssh',
    status: 'connected',
    connectionConfig: { host, port: 22, username: 'alice' },
  } as unknown as SessionRecord;
}

const map = (...recs: SessionRecord[]): ReadonlyMap<string, SessionRecord> =>
  new Map(recs.map((r) => [r.id, r]));

beforeEach(() => {
  received = undefined;
  unlisten = vi.fn();
  resetSessionNames();
  tv.broadcastSharedChange.mockReset().mockResolvedValue(undefined);
  tv.onSharedStoreChanged.mockReset().mockImplementation((cb: SharedChangeCb) => {
    received = cb;
    return Promise.resolve(unlisten);
  });
});

afterEach(() => {
  resetSessionNames();
});

describe('useSessionNameShare', () => {
  it('publishes the table once and stays quiet while it is unchanged', () => {
    const sessions = map(session('s1', 'core-sw01'));
    const { rerender } = renderHook((s: ReadonlyMap<string, SessionRecord>) => useSessionNameShare(s), {
      initialProps: sessions,
    });

    expect(tv.broadcastSharedChange).toHaveBeenCalledTimes(1);
    const [channel, payload] = tv.broadcastSharedChange.mock.calls[0];
    expect(channel).toBe(SESSION_NAMES_CHANNEL);
    expect(JSON.parse(payload)).toMatchObject({
      from: 'main',
      names: { s1: { displayName: 'core-sw01' } },
    });

    // A different Map object holding the same names is NOT a change: a window
    // that re-broadcasts on every render makes every other window re-merge.
    rerender(map(session('s1', 'core-sw01')));
    expect(tv.broadcastSharedChange).toHaveBeenCalledTimes(1);
  });

  it('publishes again when a terminal is renamed or added', () => {
    const { rerender } = renderHook((s: ReadonlyMap<string, SessionRecord>) => useSessionNameShare(s), {
      initialProps: map(session('s1', 'core-sw01')),
    });
    expect(tv.broadcastSharedChange).toHaveBeenCalledTimes(1);

    rerender(map(session('s1', 'core-sw01-renamed')));
    expect(tv.broadcastSharedChange).toHaveBeenCalledTimes(2);

    rerender(map(session('s1', 'core-sw01-renamed'), session('s2', 'edge-rtr01')));
    expect(tv.broadcastSharedChange).toHaveBeenCalledTimes(3);
    const last = JSON.parse(tv.broadcastSharedChange.mock.calls[2][1]);
    expect(Object.keys(last.names).sort()).toEqual(['s1', 's2']);
  });

  it('takes in another window’s table but ignores its own echo', () => {
    renderHook(() => useSessionNameShare(map(session('s1', 'core-sw01'))));
    expect(received).toBeDefined();

    received!({
      channel: SESSION_NAMES_CHANNEL,
      payload: JSON.stringify(buildSessionNames('win-2', { s9: { displayName: 'far-sw09' } })),
      origin: 'win-2',
    });
    expect(remoteSessionName('s9')?.displayName).toBe('far-sw09');

    // Our own broadcast comes back to us; applying it would let this window
    // overwrite its own names from a stale copy.
    received!({
      channel: SESSION_NAMES_CHANNEL,
      payload: JSON.stringify(buildSessionNames('main', { s1: { displayName: 'wrong' } })),
      origin: 'main',
    });
    expect(remoteSessionName('s1')).toBeUndefined();

    // Traffic on an unrelated channel is not ours to read.
    received!({
      channel: 'some-other-channel',
      payload: JSON.stringify(buildSessionNames('win-2', { s8: { displayName: 'nope' } })),
      origin: 'win-2',
    });
    expect(remoteSessionName('s8')).toBeUndefined();
  });

  it('stops listening on unmount, including when it unmounts mid-subscribe', async () => {
    const first = renderHook(() => useSessionNameShare(map(session('s1', 'core-sw01'))));
    // listen() resolves a tick after the effect ran; let it, so the effect is
    // holding a real handle by the time we tear the hook down.
    await act(async () => { await Promise.resolve(); });
    first.unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);

    // Now the race: listen() resolves only AFTER the component is gone. The
    // effect has no handle to clean up at that point, so it must unlisten from
    // inside the promise instead of leaking the listener for the app's lifetime.
    let resolveListen: ((un: () => void) => void) | undefined;
    const late = vi.fn();
    tv.onSharedStoreChanged.mockImplementationOnce(
      () => new Promise<() => void>((res) => { resolveListen = res; }),
    );

    const second = renderHook(() => useSessionNameShare(map(session('s1', 'core-sw01'))));
    second.unmount();
    await act(async () => {
      resolveListen!(late);
      await Promise.resolve();
    });
    expect(late).toHaveBeenCalledTimes(1);
  });
});
