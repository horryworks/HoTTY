const dirtyCounts = new Map<string, number>();

export function setEditorDirtyCount(paneId: string, count: number): void {
  if (count > 0) {
    dirtyCounts.set(paneId, count);
  } else {
    dirtyCounts.delete(paneId);
  }
}

export function clearEditorDirty(paneId: string): void {
  dirtyCounts.delete(paneId);
}

export function totalDirtyEditors(): number {
  let total = 0;
  for (const count of dirtyCounts.values()) total += count;
  return total;
}
