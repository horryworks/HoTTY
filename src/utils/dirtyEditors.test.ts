import { describe, it, expect, beforeEach } from 'vitest';
import { setEditorDirtyCount, clearEditorDirty, totalDirtyEditors } from './dirtyEditors';

describe('dirtyEditors', () => {
  beforeEach(() => {
    clearEditorDirty('a');
    clearEditorDirty('b');
    clearEditorDirty('c');
  });

  it('returns 0 when no editors are tracked', () => {
    expect(totalDirtyEditors()).toBe(0);
  });

  it('sums counts across panes', () => {
    setEditorDirtyCount('a', 2);
    setEditorDirtyCount('b', 3);
    expect(totalDirtyEditors()).toBe(5);
  });

  it('overwrites existing count for the same pane', () => {
    setEditorDirtyCount('a', 2);
    setEditorDirtyCount('a', 5);
    expect(totalDirtyEditors()).toBe(5);
  });

  it('removes the pane entry when count is 0', () => {
    setEditorDirtyCount('a', 3);
    setEditorDirtyCount('a', 0);
    expect(totalDirtyEditors()).toBe(0);
  });

  it('treats negative counts as removal', () => {
    setEditorDirtyCount('a', 3);
    setEditorDirtyCount('a', -1);
    expect(totalDirtyEditors()).toBe(0);
  });

  it('clearEditorDirty removes a pane regardless of count', () => {
    setEditorDirtyCount('a', 4);
    setEditorDirtyCount('b', 1);
    clearEditorDirty('a');
    expect(totalDirtyEditors()).toBe(1);
  });

  it('clearEditorDirty on unknown pane is a no-op', () => {
    setEditorDirtyCount('a', 2);
    clearEditorDirty('nonexistent');
    expect(totalDirtyEditors()).toBe(2);
  });
});
