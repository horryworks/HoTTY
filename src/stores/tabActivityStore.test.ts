import { describe, it, expect, beforeEach } from 'vitest';
import { useTabActivityStore } from './tabActivityStore';

const state = () => useTabActivityStore.getState();

describe('tabActivityStore', () => {
  beforeEach(() => {
    useTabActivityStore.setState({ activity: {} });
  });

  it('records the first batch for a session as-is', () => {
    state().record({ s1: { lines: 3, lastLine: 'sw-01#' } });
    expect(state().activity).toEqual({ s1: { lines: 3, lastLine: 'sw-01#' } });
  });

  it('adds line counts and replaces the last line across batches', () => {
    state().record({ s1: { lines: 3, lastLine: 'first' } });
    state().record({ s1: { lines: 2, lastLine: 'second' } });
    expect(state().activity.s1).toEqual({ lines: 5, lastLine: 'second' });
  });

  it('keeps the previous last line when a batch brings a blank one', () => {
    state().record({ s1: { lines: 1, lastLine: 'sw-01#' } });
    state().record({ s1: { lines: 1, lastLine: '' } });
    expect(state().activity.s1).toEqual({ lines: 2, lastLine: 'sw-01#' });
  });

  it('records several sessions in one batch without touching others', () => {
    state().record({ s1: { lines: 1, lastLine: 'a' } });
    state().record({ s2: { lines: 4, lastLine: 'b' }, s3: { lines: 1, lastLine: 'c' } });
    expect(Object.keys(state().activity).sort()).toEqual(['s1', 's2', 's3']);
    expect(state().activity.s1).toEqual({ lines: 1, lastLine: 'a' });
  });

  it('does not change state for an empty batch', () => {
    state().record({ s1: { lines: 1, lastLine: 'a' } });
    const before = state().activity;
    state().record({});
    expect(state().activity).toBe(before);
  });

  it('clears the given sessions and keeps the rest', () => {
    state().record({ s1: { lines: 1, lastLine: 'a' }, s2: { lines: 2, lastLine: 'b' } });
    state().clear(['s1']);
    expect(state().activity).toEqual({ s2: { lines: 2, lastLine: 'b' } });
  });

  it('does not change state when none of the cleared sessions has activity', () => {
    state().record({ s1: { lines: 1, lastLine: 'a' } });
    const before = state().activity;
    state().clear(['s9', 's10']);
    expect(state().activity).toBe(before);
    state().clear([]);
    expect(state().activity).toBe(before);
  });

  it('starts counting from zero after a session is cleared', () => {
    state().record({ s1: { lines: 5, lastLine: 'old' } });
    state().clear(['s1']);
    state().record({ s1: { lines: 1, lastLine: '' } });
    expect(state().activity.s1).toEqual({ lines: 1, lastLine: '' });
  });

  it('never mutates the previous activity record', () => {
    state().record({ s1: { lines: 1, lastLine: 'a' } });
    const before = state().activity;
    state().record({ s1: { lines: 1, lastLine: 'b' } });
    expect(before.s1).toEqual({ lines: 1, lastLine: 'a' });
    state().clear(['s1']);
    expect(before.s1).toBeDefined();
  });
});
