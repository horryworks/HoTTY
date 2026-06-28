import type { Terminal } from '@xterm/xterm';

/** 0-based buffer cell range, as returned by xterm's getSelectionPosition(). */
export interface SelectionRange {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * True when the cell at (col, absRow) — 0-based buffer coordinates — lies
 * within the selection range. `end.x` is exclusive (xterm convention), so a
 * click on the cell just past the selection's last character is NOT inside.
 */
export function isCellInSelection(col: number, absRow: number, pos: SelectionRange): boolean {
  if (absRow < pos.start.y || absRow > pos.end.y) return false;
  if (absRow === pos.start.y && col < pos.start.x) return false;
  if (absRow === pos.end.y && col >= pos.end.x) return false;
  return true;
}

/**
 * Whether a right-click landed over the current selection. Restores the old
 * Electron behavior: right-click over selected text opens the Ask AI menu,
 * right-click elsewhere pastes. Coordinates come from xterm internals
 * (`getSelectionPosition()` returns 0-based absolute buffer cells; cell pixel
 * size from `_core._renderService`), the same internals TerminalXtermHost
 * already relies on. If geometry can't be resolved we fall back to treating the
 * click as over the selection (a selection exists) so the menu still appears
 * rather than silently pasting.
 */
export function isRightClickOverSelection(
  clientX: number,
  clientY: number,
  term: Terminal
): boolean {
  const pos = term.getSelectionPosition();
  if (!pos) return false;
  const el = (term as unknown as { element?: HTMLElement }).element;
  const screenEl = el?.querySelector('.xterm-screen') as HTMLElement | null;
  const cell = (term as unknown as {
    _core?: {
      _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } };
    };
  })._core?._renderService?.dimensions?.css?.cell;
  const cellWidth = cell?.width ?? 0;
  const cellHeight = cell?.height ?? 0;
  if (!screenEl || cellWidth <= 0 || cellHeight <= 0) return true;
  const rect = screenEl.getBoundingClientRect();
  const col = Math.floor((clientX - rect.left) / cellWidth);
  const viewRow = Math.floor((clientY - rect.top) / cellHeight);
  const absRow = viewRow + term.buffer.active.viewportY;
  return isCellInSelection(col, absRow, pos);
}
