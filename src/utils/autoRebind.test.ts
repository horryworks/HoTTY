import { describe, it, expect } from 'vitest';
import { selectAutoRebinds } from './autoRebind';

describe('selectAutoRebinds', () => {
  it('rebinds an orphaned tab to the unique reconnected session with the same key', () => {
    const result = selectAutoRebinds(
      [{ id: 's-new', key: 'ssh:admin@h:22' }],
      [{ id: 's-new', key: 'ssh:admin@h:22' }],
      [{ paneId: 'p1', tabId: 't1', key: 'ssh:admin@h:22' }],
    );
    expect(result).toEqual([{ paneId: 'p1', tabId: 't1', sessionId: 's-new' }]);
  });

  it('does NOT rebind when two live sessions share the key (ambiguous target)', () => {
    const connected = [
      { id: 's-a', key: 'ssh:admin@h:22' },
      { id: 's-b', key: 'ssh:admin@h:22' },
    ];
    const result = selectAutoRebinds(connected, connected, [
      { paneId: 'p1', tabId: 't1', key: 'ssh:admin@h:22' },
    ]);
    expect(result).toEqual([]);
  });

  it('does NOT rebind when two orphaned tabs share the key (ambiguous tab)', () => {
    const result = selectAutoRebinds(
      [{ id: 's-new', key: 'ssh:admin@h:22' }],
      [{ id: 's-new', key: 'ssh:admin@h:22' }],
      [
        { paneId: 'p1', tabId: 't1', key: 'ssh:admin@h:22' },
        { paneId: 'p1', tabId: 't2', key: 'ssh:admin@h:22' },
      ],
    );
    expect(result).toEqual([]);
  });

  it('ignores orphans with no matching live session', () => {
    const result = selectAutoRebinds(
      [{ id: 's-new', key: 'ssh:admin@h:22' }],
      [{ id: 's-new', key: 'ssh:admin@h:22' }],
      [{ paneId: 'p1', tabId: 't1', key: 'serial:COM3' }],
    );
    expect(result).toEqual([]);
  });

  it('rebinds multiple distinct targets independently', () => {
    const connected = [
      { id: 's-1', key: 'ssh:admin@h1:22' },
      { id: 's-2', key: 'ssh:admin@h2:22' },
    ];
    const result = selectAutoRebinds(connected, connected, [
      { paneId: 'p1', tabId: 't1', key: 'ssh:admin@h1:22' },
      { paneId: 'p2', tabId: 't2', key: 'ssh:admin@h2:22' },
    ]);
    expect(result).toEqual([
      { paneId: 'p1', tabId: 't1', sessionId: 's-1' },
      { paneId: 'p2', tabId: 't2', sessionId: 's-2' },
    ]);
  });
});
