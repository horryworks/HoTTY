import { describe, it, expect } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import {
  isCellInSelection,
  isRightClickOverSelection,
  type SelectionRange,
} from './selectionGeometry';

describe('isCellInSelection', () => {
  describe('single-row selection { (2,5) → (6,5) } (end.x exclusive)', () => {
    const pos: SelectionRange = { start: { x: 2, y: 5 }, end: { x: 6, y: 5 } };

    it('includes the first selected cell', () => {
      expect(isCellInSelection(2, 5, pos)).toBe(true);
    });

    it('includes the last selected cell (end.x - 1)', () => {
      expect(isCellInSelection(5, 5, pos)).toBe(true);
    });

    it('excludes the cell at end.x (exclusive end)', () => {
      expect(isCellInSelection(6, 5, pos)).toBe(false);
    });

    it('excludes the cell just before start.x', () => {
      expect(isCellInSelection(1, 5, pos)).toBe(false);
    });

    it('excludes rows above and below', () => {
      expect(isCellInSelection(3, 4, pos)).toBe(false);
      expect(isCellInSelection(3, 6, pos)).toBe(false);
    });
  });

  describe('multi-row selection { (3,2) → (4,5) }', () => {
    const pos: SelectionRange = { start: { x: 3, y: 2 }, end: { x: 4, y: 5 } };

    it('applies the start.x bound only on the first row', () => {
      expect(isCellInSelection(2, 2, pos)).toBe(false); // before start.x on first row
      expect(isCellInSelection(3, 2, pos)).toBe(true);
      expect(isCellInSelection(100, 2, pos)).toBe(true); // no end bound on first row
    });

    it('includes every column on interior rows', () => {
      expect(isCellInSelection(0, 3, pos)).toBe(true);
      expect(isCellInSelection(0, 4, pos)).toBe(true);
      expect(isCellInSelection(999, 4, pos)).toBe(true);
    });

    it('applies the exclusive end.x bound only on the last row', () => {
      expect(isCellInSelection(0, 5, pos)).toBe(true);
      expect(isCellInSelection(3, 5, pos)).toBe(true);
      expect(isCellInSelection(4, 5, pos)).toBe(false); // == end.x on last row
    });

    it('excludes rows outside the range', () => {
      expect(isCellInSelection(3, 1, pos)).toBe(false);
      expect(isCellInSelection(3, 6, pos)).toBe(false);
    });
  });
});

describe('isRightClickOverSelection', () => {
  interface Cell {
    width?: number;
    height?: number;
  }

  function makeTerm(opts: {
    pos: SelectionRange | undefined;
    cell?: Cell;
    hasScreenEl?: boolean;
    rect?: { left: number; top: number };
    viewportY?: number;
  }): Terminal {
    const screenEl =
      opts.hasScreenEl === false
        ? null
        : { getBoundingClientRect: () => ({ left: opts.rect?.left ?? 0, top: opts.rect?.top ?? 0 }) };
    return {
      getSelectionPosition: () => opts.pos,
      element: { querySelector: () => screenEl },
      buffer: { active: { viewportY: opts.viewportY ?? 0 } },
      _core: { _renderService: { dimensions: { css: { cell: opts.cell } } } },
    } as unknown as Terminal;
  }

  it('returns false when there is no selection', () => {
    const term = makeTerm({ pos: undefined });
    expect(isRightClickOverSelection(10, 10, term)).toBe(false);
  });

  it('falls back to true when cell geometry cannot be resolved (selection exists)', () => {
    // A selection exists but the cell dimensions are unusable → prefer showing
    // the Ask AI menu over silently pasting.
    const pos: SelectionRange = { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } };
    expect(isRightClickOverSelection(8, 0, makeTerm({ pos, cell: { width: 0, height: 16 } }))).toBe(true);
    expect(isRightClickOverSelection(8, 0, makeTerm({ pos, cell: undefined }))).toBe(true);
    expect(isRightClickOverSelection(8, 0, makeTerm({ pos, cell: { width: 8, height: 16 }, hasScreenEl: false }))).toBe(true);
  });

  it('maps click coordinates to a cell and reports a hit over the selection', () => {
    const pos: SelectionRange = { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } };
    const term = makeTerm({ pos, cell: { width: 8, height: 16 } });
    // clientX=8 → col 1, clientY=0 → row 0 → inside [0,5) on row 0.
    expect(isRightClickOverSelection(8, 0, term)).toBe(true);
  });

  it('reports a miss when the click lands past the selection', () => {
    const pos: SelectionRange = { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } };
    const term = makeTerm({ pos, cell: { width: 8, height: 16 } });
    // clientX=48 → col 6 ≥ end.x (5) → outside.
    expect(isRightClickOverSelection(48, 0, term)).toBe(false);
  });

  it('accounts for the viewport scroll offset (viewportY) when computing the buffer row', () => {
    // Selection is on absolute buffer row 10; the viewport is scrolled so that
    // row 10 is the first visible row. A click on the top visible row must map
    // to absRow 10 and hit the selection.
    const pos: SelectionRange = { start: { x: 0, y: 10 }, end: { x: 3, y: 10 } };
    const term = makeTerm({ pos, cell: { width: 8, height: 16 }, viewportY: 10 });
    expect(isRightClickOverSelection(0, 0, term)).toBe(true);
    // The same pixel without the scroll offset would map to absRow 0 → miss.
    const unscrolled = makeTerm({ pos, cell: { width: 8, height: 16 }, viewportY: 0 });
    expect(isRightClickOverSelection(0, 0, unscrolled)).toBe(false);
  });
});
