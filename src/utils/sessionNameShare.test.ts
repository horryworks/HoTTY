import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SESSION_NAMES_VERSION,
  applySessionNames,
  buildSessionNames,
  forgetWindowNames,
  parseSessionNames,
  remoteSessionName,
  remoteSessionNames,
  resetSessionNames,
  sessionNamesEqual,
  subscribeSessionNames,
} from './sessionNameShare';

describe('sessionNameShare wire format', () => {
  it('round-trips a table', () => {
    const msg = buildSessionNames('main', {
      's-1': { displayName: 'core-sw01', bindingKey: 'ssh:10.0.0.1:22:alice' },
      's-2': { displayName: 'rtr-01' },
    });
    const got = parseSessionNames(JSON.stringify(msg));
    expect(got).not.toBeNull();
    expect(got!.from).toBe('main');
    expect(got!.names['s-1'].displayName).toBe('core-sw01');
    expect(got!.names['s-1'].bindingKey).toBe('ssh:10.0.0.1:22:alice');
    expect(got!.names['s-2'].bindingKey).toBeUndefined();
  });

  it('refuses an unrecognised wire version', () => {
    const raw = JSON.stringify({ v: SESSION_NAMES_VERSION + 1, from: 'main', names: {} });
    expect(parseSessionNames(raw)).toBeNull();
  });

  it('never throws on malformed input', () => {
    for (const bad of ['', '{', 'null', '[]', '"str"', '{"v":1}', '{"v":1,"from":"main"}']) {
      expect(() => parseSessionNames(bad)).not.toThrow();
      expect(parseSessionNames(bad)).toBeNull();
    }
  });

  it('drops entries that carry no usable name instead of failing the message', () => {
    const raw = JSON.stringify({
      v: SESSION_NAMES_VERSION,
      from: 'win-2',
      names: {
        good: { displayName: 'sw-01' },
        empty: { displayName: '' },
        wrong: 'not an object',
        missing: { bindingKey: 'k' },
      },
    });
    const got = parseSessionNames(raw);
    expect(got).not.toBeNull();
    expect(Object.keys(got!.names)).toEqual(['good']);
  });
});

describe('sessionNameShare registry', () => {
  beforeEach(() => resetSessionNames());

  it('starts empty', () => {
    expect(remoteSessionName('s-1')).toBeUndefined();
    expect(remoteSessionNames().size).toBe(0);
  });

  it('merges tables from several windows', () => {
    applySessionNames(buildSessionNames('main', { 's-1': { displayName: 'core-sw01' } }));
    applySessionNames(buildSessionNames('win-2', { 's-9': { displayName: 'rtr-01' } }));
    expect(remoteSessionName('s-1')?.displayName).toBe('core-sw01');
    expect(remoteSessionName('s-9')?.displayName).toBe('rtr-01');
  });

  it('replaces a window table wholesale, so a closed tab stops being named', () => {
    applySessionNames(buildSessionNames('main', {
      's-1': { displayName: 'core-sw01' },
      's-2': { displayName: 'rtr-01' },
    }));
    applySessionNames(buildSessionNames('main', { 's-1': { displayName: 'core-sw01' } }));
    expect(remoteSessionName('s-2')).toBeUndefined();
    expect(remoteSessionName('s-1')?.displayName).toBe('core-sw01');
  });

  it('an empty table means that window has nothing left to name', () => {
    applySessionNames(buildSessionNames('win-2', { 's-9': { displayName: 'rtr-01' } }));
    applySessionNames(buildSessionNames('win-2', {}));
    expect(remoteSessionName('s-9')).toBeUndefined();
  });

  it('forgetting one window leaves the others alone', () => {
    applySessionNames(buildSessionNames('main', { 's-1': { displayName: 'core-sw01' } }));
    applySessionNames(buildSessionNames('win-2', { 's-9': { displayName: 'rtr-01' } }));
    forgetWindowNames('win-2');
    expect(remoteSessionName('s-9')).toBeUndefined();
    expect(remoteSessionName('s-1')?.displayName).toBe('core-sw01');
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const spy = vi.fn();
    const off = subscribeSessionNames(spy);
    applySessionNames(buildSessionNames('main', { 's-1': { displayName: 'a' } }));
    expect(spy).toHaveBeenCalledTimes(1);
    off();
    applySessionNames(buildSessionNames('main', { 's-1': { displayName: 'b' } }));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('sessionNamesEqual', () => {
  it('is true only when both tables say the same thing', () => {
    const a = { 's-1': { displayName: 'core-sw01', bindingKey: 'k' } };
    expect(sessionNamesEqual(a, { 's-1': { displayName: 'core-sw01', bindingKey: 'k' } })).toBe(true);
    expect(sessionNamesEqual(a, { 's-1': { displayName: 'renamed', bindingKey: 'k' } })).toBe(false);
    // A reconnect changes the binding key without renaming the tab: still a change.
    expect(sessionNamesEqual(a, { 's-1': { displayName: 'core-sw01', bindingKey: 'k2' } })).toBe(false);
    expect(sessionNamesEqual(a, {})).toBe(false);
    expect(sessionNamesEqual(a, { 's-2': { displayName: 'core-sw01', bindingKey: 'k' } })).toBe(false);
    expect(sessionNamesEqual({}, {})).toBe(true);
  });
});
