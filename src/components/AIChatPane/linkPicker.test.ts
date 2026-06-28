import { describe, it, expect } from 'vitest';
import { groupLinkableSessions } from './linkPicker';
import type { LinkableSession } from '../../types/appTypes';

const mk = (
  sessionId: string,
  ownerLabel: string,
  isLocal: boolean,
): LinkableSession => ({ sessionId, displayName: sessionId, ownerLabel, isLocal, status: 'connected' });

describe('groupLinkableSessions', () => {
  it('returns empty groups for undefined/empty input', () => {
    expect(groupLinkableSessions(undefined)).toEqual({ local: [], remote: [] });
    expect(groupLinkableSessions([])).toEqual({ local: [], remote: [] });
  });

  it('separates this-window sessions from other windows', () => {
    const { local, remote } = groupLinkableSessions([
      mk('s1', 'main', true),
      mk('s2', 'main', true),
      mk('r1', 'win-1', false),
    ]);
    expect(local.map((s) => s.sessionId)).toEqual(['s1', 's2']);
    expect(remote).toHaveLength(1);
    expect(remote[0][0]).toBe('win-1');
    expect(remote[0][1].map((s) => s.sessionId)).toEqual(['r1']);
  });

  it('groups remote sessions by owning window', () => {
    const { remote } = groupLinkableSessions([
      mk('r1', 'win-1', false),
      mk('r2', 'win-2', false),
      mk('r3', 'win-1', false),
    ]);
    const byLabel = Object.fromEntries(remote.map(([label, list]) => [label, list.map((s) => s.sessionId)]));
    expect(byLabel).toEqual({ 'win-1': ['r1', 'r3'], 'win-2': ['r2'] });
  });
});
