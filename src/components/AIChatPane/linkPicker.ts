import type { LinkableSession } from '../../types/appTypes';

interface LinkGroups {
  /** This window's own sessions. */
  local: LinkableSession[];
  /** Other windows' sessions, as [windowLabel, sessions] pairs (insertion order). */
  remote: [string, LinkableSession[]][];
}

/**
 * Split the AI Chat link-picker sessions into "this window" and one group per
 * other window, for grouped rendering (`<optgroup>` per window). Pure so it can
 * be unit-tested without rendering the authenticated AIChatPane.
 */
export function groupLinkableSessions(sessions: LinkableSession[] | undefined): LinkGroups {
  const local: LinkableSession[] = [];
  const remoteByWindow = new Map<string, LinkableSession[]>();
  for (const s of sessions ?? []) {
    if (s.isLocal) {
      local.push(s);
    } else {
      const arr = remoteByWindow.get(s.ownerLabel) ?? [];
      arr.push(s);
      remoteByWindow.set(s.ownerLabel, arr);
    }
  }
  return { local, remote: Array.from(remoteByWindow.entries()) };
}
