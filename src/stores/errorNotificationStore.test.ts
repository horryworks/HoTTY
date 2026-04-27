import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useErrorNotificationStore } from './errorNotificationStore';

describe('errorNotificationStore', () => {
  beforeEach(() => {
    useErrorNotificationStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty', () => {
    expect(useErrorNotificationStore.getState().notifications).toEqual([]);
  });

  it('push adds a notification with id, category, message, and timestamp', () => {
    useErrorNotificationStore.getState().push('SSH', 'connection refused');
    const list = useErrorNotificationStore.getState().notifications;
    expect(list).toHaveLength(1);
    expect(list[0].category).toBe('SSH');
    expect(list[0].message).toBe('connection refused');
    expect(typeof list[0].id).toBe('string');
    expect(list[0].id.length).toBeGreaterThan(0);
    expect(typeof list[0].timestamp).toBe('number');
  });

  it('push assigns unique ids to consecutive notifications', () => {
    const store = useErrorNotificationStore.getState();
    store.push('A', 'one');
    store.push('A', 'two');
    const list = useErrorNotificationStore.getState().notifications;
    expect(list[0].id).not.toBe(list[1].id);
  });

  it('caps the queue at 5 entries, evicting the oldest first', () => {
    const store = useErrorNotificationStore.getState();
    for (let i = 0; i < 8; i++) {
      store.push('cat', `msg ${i}`);
    }
    const list = useErrorNotificationStore.getState().notifications;
    expect(list).toHaveLength(5);
    expect(list[0].message).toBe('msg 3');
    expect(list[4].message).toBe('msg 7');
  });

  it('dismiss removes only the matching notification', () => {
    const store = useErrorNotificationStore.getState();
    store.push('A', 'one');
    store.push('B', 'two');
    store.push('C', 'three');
    const targetId = useErrorNotificationStore.getState().notifications[1].id;
    store.dismiss(targetId);
    const list = useErrorNotificationStore.getState().notifications;
    expect(list.map((n) => n.message)).toEqual(['one', 'three']);
  });

  it('dismiss with unknown id is a no-op', () => {
    const store = useErrorNotificationStore.getState();
    store.push('A', 'one');
    store.dismiss('does-not-exist');
    expect(useErrorNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('clear empties the queue', () => {
    const store = useErrorNotificationStore.getState();
    store.push('A', 'one');
    store.push('B', 'two');
    store.clear();
    expect(useErrorNotificationStore.getState().notifications).toEqual([]);
  });

  it('coalesces an exact duplicate of the most recent entry within 500ms', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T00:00:00Z'));
    const store = useErrorNotificationStore.getState();
    store.push('Session', 'host: connection refused');
    vi.advanceTimersByTime(100);
    store.push('Session', 'host: connection refused');
    expect(useErrorNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('does not coalesce after the dedup window expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T00:00:00Z'));
    const store = useErrorNotificationStore.getState();
    store.push('Session', 'host: connection refused');
    vi.advanceTimersByTime(600);
    store.push('Session', 'host: connection refused');
    expect(useErrorNotificationStore.getState().notifications).toHaveLength(2);
  });

  it('does not coalesce if the duplicate is not the most recent entry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T00:00:00Z'));
    const store = useErrorNotificationStore.getState();
    store.push('Session', 'host: connection refused');
    vi.advanceTimersByTime(50);
    store.push('Session', 'a different message');
    vi.advanceTimersByTime(50);
    store.push('Session', 'host: connection refused');
    expect(useErrorNotificationStore.getState().notifications).toHaveLength(3);
  });
});
