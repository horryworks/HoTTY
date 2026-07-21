import { describe, it, expect } from 'vitest';
import { decideWatchToggle } from './watchRouting';

const tab = (id: string, ...sessionIds: string[]) => ({
  id,
  linkedSessions: sessionIds.map((sessionId) => ({ sessionId })),
});

describe('decideWatchToggle', () => {
  it('creates a fresh tab when there is no active tab yet (cold start)', () => {
    expect(decideWatchToggle('s1', undefined)).toEqual({ action: 'create' });
  });

  it('adds the session to the active tab when it is not already watched', () => {
    expect(decideWatchToggle('s1', tab('t1'))).toEqual({ action: 'add', tabId: 't1' });
  });

  it('adds to a tab that already watches OTHER terminals (multi-watch)', () => {
    expect(decideWatchToggle('s2', tab('t1', 's1'))).toEqual({ action: 'add', tabId: 't1' });
  });

  it('removes the session when the active tab already watches it (toggle off)', () => {
    expect(decideWatchToggle('s1', tab('t1', 's1'))).toEqual({ action: 'remove', tabId: 't1' });
  });

  it('removes only the toggled session when several are watched', () => {
    expect(decideWatchToggle('s2', tab('t1', 's1', 's2', 's3'))).toEqual({ action: 'remove', tabId: 't1' });
  });
});
