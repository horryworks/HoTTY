import { describe, it, expect } from 'vitest';
import { buildTabItems, sessionDetail, paneBadge, groupTabs } from './tabBarHelpers';
import type { SessionRecord } from '../../hooks/useSessionManager';
import type { FeaturePaneInfo } from '../../utils/paneTypes';

const makeSession = (id: string, overrides?: Partial<SessionRecord>): SessionRecord => ({
  id,
  displayName: `Session ${id}`,
  protocol: 'ssh' as SessionRecord['protocol'],
  status: 'connected',
  term: {} as SessionRecord['term'],
  fitAddon: {} as SessionRecord['fitAddon'],
  fixedSize: false,
  ...overrides,
});

const makeFeature = (id: string, type: FeaturePaneInfo['type']): FeaturePaneInfo => ({
  id,
  displayName: `Feature ${id}`,
  type,
});

describe('buildTabItems', () => {
  it('returns empty array when no sessions or features', () => {
    expect(buildTabItems([], [], [])).toEqual([]);
  });

  it('builds session tabs in order', () => {
    const sessions = [makeSession('s1'), makeSession('s2')];
    const result = buildTabItems(sessions, [], ['s1', 's2']);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('s1');
    expect(result[0].kind).toBe('session');
    expect(result[1].id).toBe('s2');
  });

  it('builds feature tabs in order', () => {
    const features = [makeFeature('f1', 'log-viewer'), makeFeature('f2', 'ai-chat')];
    const result = buildTabItems([], features, ['f1', 'f2']);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('feature');
    expect(result[0].featureType).toBe('log-viewer');
    expect(result[1].isAiTab).toBe(true);
  });

  it('interleaves sessions and features by order', () => {
    const sessions = [makeSession('s1')];
    const features = [makeFeature('f1', 'file-server')];
    const result = buildTabItems(sessions, features, ['f1', 's1']);
    expect(result[0].id).toBe('f1');
    expect(result[1].id).toBe('s1');
  });

  it('marks a watched session from the map and threads its color index + owner', () => {
    const sessions = [makeSession('s1'), makeSession('s2')];
    const watched = new Map([['s2', { tabId: 't1', colorIndex: 1 }]]);
    const result = buildTabItems(sessions, [], ['s1', 's2'], watched);
    expect(result[0].isWatching).toBe(false);
    expect(result[0].watchColorIndex).toBeUndefined();
    expect(result[1].isWatching).toBe(true);
    expect(result[1].watchColorIndex).toBe(1);
    expect(result[1].watchOwnerTabId).toBe('t1');
  });

  it('lights up EVERY watched session (multi-watch), each in its own color', () => {
    const sessions = [makeSession('s1'), makeSession('s2'), makeSession('s3')];
    const watched = new Map([
      ['s1', { tabId: 't1', colorIndex: 0 }],
      ['s3', { tabId: 't2', colorIndex: 1 }],
    ]);
    const result = buildTabItems(sessions, [], ['s1', 's2', 's3'], watched);
    expect(result.map((r) => r.isWatching)).toEqual([true, false, true]);
    expect(result[0].watchColorIndex).toBe(0);
    expect(result[2].watchColorIndex).toBe(1);
  });

  it('treats an empty map as nothing watched', () => {
    const sessions = [makeSession('s1')];
    const result = buildTabItems(sessions, [], ['s1'], new Map());
    expect(result[0].isWatching).toBe(false);
    expect(result[0].watchColorIndex).toBeUndefined();
  });

  it('skips IDs not in sessions or features', () => {
    const result = buildTabItems([], [], ['unknown-id']);
    expect(result).toHaveLength(0);
  });

  it('includes session status and error', () => {
    const sessions = [makeSession('s1', { status: 'error', errorMessage: 'timeout' })];
    const result = buildTabItems(sessions, [], ['s1']);
    expect(result[0].status).toBe('error');
    expect(result[0].errorMessage).toBe('timeout');
  });

  it('threads fixedSize and ptyCols onto session tab items (gates the fixed-size menu)', () => {
    const sessions = [makeSession('s1', { fixedSize: true, ptyCols: 216 })];
    const result = buildTabItems(sessions, [], ['s1']);
    expect(result[0].fixedSize).toBe(true);
    expect(result[0].ptyCols).toBe(216);
  });

  it('leaves ptyCols undefined before the connect-time pty-size event', () => {
    const result = buildTabItems([makeSession('s1')], [], ['s1']);
    expect(result[0].ptyCols).toBeUndefined();
    expect(result[0].fixedSize).toBe(false);
  });
});

describe('sessionDetail', () => {
  it('names the protocol and the host for ssh/telnet', () => {
    expect(sessionDetail({ protocol: 'ssh', connectionConfig: { host: '192.0.2.10' } as never })).toBe('SSH · 192.0.2.10');
    expect(sessionDetail({ protocol: 'telnet', connectionConfig: { host: 'sw-01' } as never })).toBe('Telnet · sw-01');
  });

  it('falls back to the protocol name when the target is unknown', () => {
    expect(sessionDetail({ protocol: 'ssh' })).toBe('SSH');
    expect(sessionDetail({ protocol: 'powershell' })).toBe('PowerShell');
  });

  it('describes serial, wsl and iap targets', () => {
    expect(sessionDetail({ protocol: 'serial', connectionConfig: { path: 'COM3', baudRate: 9600 } as never })).toBe('COM3 · 9600');
    expect(sessionDetail({ protocol: 'wsl', connectionConfig: { distribution: 'Ubuntu' } as never })).toBe('WSL · Ubuntu');
    expect(sessionDetail({ protocol: 'wsl', connectionConfig: {} as never })).toBe('WSL');
    expect(sessionDetail({ protocol: 'gcloud-iap', connectionConfig: { instance: 'vm-01' } as never })).toBe('IAP · vm-01');
  });

  it('is carried on session tabs by buildTabItems', () => {
    const [item] = buildTabItems([makeSession('s1', { connectionConfig: { host: 'h' } as never })], [], ['s1']);
    expect(item.detail).toBe('SSH · h');
  });
});

describe('paneBadge', () => {
  it('numbers grid cells and names edge bars', () => {
    expect(paneBadge('0')).toEqual({ kind: 'grid', index: 0 });
    expect(paneBadge('5')).toEqual({ kind: 'grid', index: 5 });
    expect(paneBadge('bar-left')).toEqual({ kind: 'edge', edge: 'left' });
    expect(paneBadge('bar-bottom')).toEqual({ kind: 'edge', edge: 'bottom' });
    expect(paneBadge('nonsense')).toBeNull();
  });
});

describe('groupTabs', () => {
  const items = buildTabItems(
    [makeSession('a'), makeSession('b'), makeSession('c'), makeSession('d')],
    [],
    ['a', 'b', 'c', 'd']
  );

  it('orders shown tabs by pane and keeps the rest in tab order', () => {
    const { shown, hidden } = groupTabs(items, ['0', '1', 'bar-left'], { '0': 'c', '1': 'a', 'bar-left': null });
    expect(shown.map((p) => [p.item.id, p.paneId])).toEqual([['c', '0'], ['a', '1']]);
    expect(hidden.map((i) => i.id)).toEqual(['b', 'd']);
  });

  it('treats a tab in a pane that is not visible as hidden', () => {
    const { shown, hidden } = groupTabs(items, ['0'], { '0': 'a', 'bar-right': 'b' });
    expect(shown.map((p) => p.item.id)).toEqual(['a']);
    expect(hidden.map((i) => i.id)).toEqual(['b', 'c', 'd']);
  });
});
