import { describe, it, expect } from 'vitest';
import { decideWatchRouting } from './watchRouting';

const live = (...ids: string[]) => (id: string) => ids.includes(id);

describe('decideWatchRouting', () => {
  it('unlinks when the active tab already links the watched session (toggle off)', () => {
    const tabs = [{ id: 't1', linkedSessionId: 's1' }];
    expect(decideWatchRouting('s1', tabs, 't1', live('s1'))).toEqual({ action: 'unlink', tabId: 't1' });
  });

  it('switches to an existing non-active tab that links the watched session', () => {
    const tabs = [
      { id: 't1', linkedSessionId: 's0' },
      { id: 't2', linkedSessionId: 's1' },
    ];
    expect(decideWatchRouting('s1', tabs, 't1', live('s0', 's1'))).toEqual({ action: 'switch', tabId: 't2' });
  });

  it('relinks an empty active tab in place', () => {
    const tabs = [{ id: 't1' }];
    expect(decideWatchRouting('s1', tabs, 't1', live('s1'))).toEqual({ action: 'relink', tabId: 't1', evictSessionId: undefined });
  });

  it('relinks in place AND evicts the dead buffer when the active link is stale (the reconnect fix)', () => {
    // Active tab links s-old which is no longer live; user watches the reconnected s-new.
    const tabs = [{ id: 't1', linkedSessionId: 's-old' }];
    expect(decideWatchRouting('s-new', tabs, 't1', live('s-new'))).toEqual({
      action: 'relink',
      tabId: 't1',
      evictSessionId: 's-old',
    });
  });

  it('creates a new tab when the active tab holds a DIFFERENT live link', () => {
    const tabs = [{ id: 't1', linkedSessionId: 's-other' }];
    expect(decideWatchRouting('s-new', tabs, 't1', live('s-new', 's-other'))).toEqual({ action: 'new-tab' });
  });
});
