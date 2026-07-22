import { describe, it, expect } from 'vitest';
import { decideWatchToggle, planWatchIn } from './watchRouting';

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

describe('planWatchIn (single-owner "Watch in ▸" picker)', () => {
  it('pure-adds when the session is not watched anywhere yet', () => {
    const tabs = [tab('t1', 'other'), tab('t2')];
    expect(planWatchIn('s1', tabs, 't2')).toEqual({ removeFrom: [], addTo: 't2' });
  });

  it('MOVES the session from its current owner to a different conversation', () => {
    const tabs = [tab('t1', 's1'), tab('t2', 'other')];
    expect(planWatchIn('s1', tabs, 't2')).toEqual({ removeFrom: ['t1'], addTo: 't2' });
  });

  it('toggles OFF when the target is the session\'s current owner', () => {
    const tabs = [tab('t1', 's1'), tab('t2')];
    expect(planWatchIn('s1', tabs, 't1')).toEqual({ removeFrom: ['t1'], addTo: null });
  });

  it('moves into a fresh conversation for target "new", leaving the old owner', () => {
    const tabs = [tab('t1', 's1'), tab('t2', 's2')];
    expect(planWatchIn('s1', tabs, 'new')).toEqual({ removeFrom: ['t1'], addTo: 'new' });
  });

  it('adds into a new conversation when not previously watched', () => {
    const tabs = [tab('t1', 'other')];
    expect(planWatchIn('s1', tabs, 'new')).toEqual({ removeFrom: [], addTo: 'new' });
  });

  it('defensively lists every owner if a stale duplicate slipped past the invariant', () => {
    const tabs = [tab('t1', 's1'), tab('t2', 's1'), tab('t3')];
    expect(planWatchIn('s1', tabs, 't3')).toEqual({ removeFrom: ['t1', 't2'], addTo: 't3' });
  });
});
