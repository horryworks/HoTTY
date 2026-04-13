import { describe, it, expect } from 'vitest';
import { buildTabItems } from './tabBarHelpers';
import type { SessionRecord } from '../../hooks/useSessionManager';
import type { FeaturePaneInfo } from '../../utils/paneTypes';

const makeSession = (id: string, overrides?: Partial<SessionRecord>): SessionRecord => ({
  id,
  displayName: `Session ${id}`,
  protocol: 'ssh' as SessionRecord['protocol'],
  status: 'connected',
  term: {} as SessionRecord['term'],
  fitAddon: {} as SessionRecord['fitAddon'],
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
    const features = [makeFeature('f1', 'text-editor')];
    const result = buildTabItems(sessions, features, ['f1', 's1']);
    expect(result[0].id).toBe('f1');
    expect(result[1].id).toBe('s1');
  });

  it('marks watching session', () => {
    const sessions = [makeSession('s1'), makeSession('s2')];
    const result = buildTabItems(sessions, [], ['s1', 's2'], 's2');
    expect(result[0].isWatching).toBe(false);
    expect(result[1].isWatching).toBe(true);
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
});
