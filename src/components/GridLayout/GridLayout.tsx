import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePaneStore, gridPaneIds } from '../../stores/paneStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { STORAGE_KEYS } from '../../constants/storage';
import './GridLayout.css';

interface GridLayoutProps {
  renderPane: (paneId: string) => ReactNode;
  onDropSession: (sessionId: string, targetPaneId: string) => void;
}

type ResizeType = 'col' | 'row' | 'both';

interface ResizingState {
  type: ResizeType;
  index: number;
  rowIndex?: number;
  startPos: { x: number; y: number };
  startColSizes: number[];
  startRowSizes: number[];
  gridSize: { width: number; height: number };
}

const MIN_SIZE_FR = 0.1;
const RESIZER_PX = 4;

function loadSizes(key: string, count: number): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === count && parsed.every((n) => typeof n === 'number' && n > 0)) {
        return parsed as number[];
      }
    }
  } catch {
    // fall through
  }
  return new Array(count).fill(1);
}

export function GridLayout({ renderPane, onDropSession }: GridLayoutProps) {
  const layoutMode = usePaneStore((s) => s.layoutMode);
  const [rows, cols] = layoutMode.split('x').map((n) => parseInt(n, 10));
  const paneIds = gridPaneIds(layoutMode);
  const [dragOverPaneId, setDragOverPaneId] = useState<string | null>(null);

  const paneBackground = useSettingsStore((s) => s.paneBackground);
  const paneBackgroundMode = useSettingsStore((s) => s.paneBackgroundMode);
  const paneBackgroundImage = useSettingsStore((s) => s.paneBackgroundImage);
  const cellBackgroundStyle = useMemo<CSSProperties>(
    () => ({
      backgroundColor: paneBackground || 'var(--bg-primary)',
      backgroundImage:
        paneBackgroundMode === 'image' && paneBackgroundImage
          ? `url("${paneBackgroundImage}")`
          : 'none',
      backgroundRepeat: 'repeat',
      backgroundPosition: 'center',
    }),
    [paneBackground, paneBackgroundMode, paneBackgroundImage]
  );

  const [colSizes, setColSizes] = useState<number[]>(() =>
    loadSizes(STORAGE_KEYS.UI_GRID_COL_SIZES(cols), cols)
  );
  const [rowSizes, setRowSizes] = useState<number[]>(() =>
    loadSizes(STORAGE_KEYS.UI_GRID_ROW_SIZES(rows), rows)
  );

  useEffect(() => {
    setColSizes(loadSizes(STORAGE_KEYS.UI_GRID_COL_SIZES(cols), cols));
  }, [cols]);

  useEffect(() => {
    setRowSizes(loadSizes(STORAGE_KEYS.UI_GRID_ROW_SIZES(rows), rows));
  }, [rows]);

  useEffect(() => {
    if (colSizes.length === cols && cols > 0) {
      localStorage.setItem(STORAGE_KEYS.UI_GRID_COL_SIZES(cols), JSON.stringify(colSizes));
    }
  }, [colSizes, cols]);

  useEffect(() => {
    if (rowSizes.length === rows && rows > 0) {
      localStorage.setItem(STORAGE_KEYS.UI_GRID_ROW_SIZES(rows), JSON.stringify(rowSizes));
    }
  }, [rowSizes, rows]);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const resizingState = useRef<ResizingState | null>(null);
  const resizeRafId = useRef<number | null>(null);
  const [activeResizer, setActiveResizer] = useState<string | null>(null);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizingState.current) return;
    if (resizeRafId.current !== null) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    resizeRafId.current = requestAnimationFrame(() => {
      resizeRafId.current = null;
      const s = resizingState.current;
      if (!s) return;
      const { type, index, rowIndex, startPos, startColSizes, startRowSizes, gridSize } = s;

      if ((type === 'col' || type === 'both') && gridSize.width > 0) {
        const deltaPx = clientX - startPos.x;
        const totalFr = startColSizes.reduce((sum, v) => sum + v, 0);
        const deltaFr = (deltaPx * totalFr) / gridSize.width;
        const next = [...startColSizes];
        let left = startColSizes[index] + deltaFr;
        let right = startColSizes[index + 1] - deltaFr;
        const pair = startColSizes[index] + startColSizes[index + 1];
        if (left < MIN_SIZE_FR) {
          left = MIN_SIZE_FR;
          right = pair - MIN_SIZE_FR;
        }
        if (right < MIN_SIZE_FR) {
          right = MIN_SIZE_FR;
          left = pair - MIN_SIZE_FR;
        }
        next[index] = left;
        next[index + 1] = right;
        setColSizes(next);
      }

      if ((type === 'row' || type === 'both') && gridSize.height > 0) {
        const rIdx = type === 'row' ? index : rowIndex!;
        const deltaPx = clientY - startPos.y;
        const totalFr = startRowSizes.reduce((sum, v) => sum + v, 0);
        const deltaFr = (deltaPx * totalFr) / gridSize.height;
        const next = [...startRowSizes];
        let top = startRowSizes[rIdx] + deltaFr;
        let bottom = startRowSizes[rIdx + 1] - deltaFr;
        const pair = startRowSizes[rIdx] + startRowSizes[rIdx + 1];
        if (top < MIN_SIZE_FR) {
          top = MIN_SIZE_FR;
          bottom = pair - MIN_SIZE_FR;
        }
        if (bottom < MIN_SIZE_FR) {
          bottom = MIN_SIZE_FR;
          top = pair - MIN_SIZE_FR;
        }
        next[rIdx] = top;
        next[rIdx + 1] = bottom;
        setRowSizes(next);
      }
    });
  }, []);

  const handleResizeEndRef = useRef<() => void>(() => {});
  const handleResizeEnd = useCallback(() => {
    resizingState.current = null;
    if (resizeRafId.current !== null) {
      cancelAnimationFrame(resizeRafId.current);
      resizeRafId.current = null;
    }
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEndRef.current);
    document.body.style.cursor = '';
    setActiveResizer(null);
  }, [handleResizeMove]);

  useEffect(() => {
    handleResizeEndRef.current = handleResizeEnd;
  }, [handleResizeEnd]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, type: ResizeType, index: number, rowIndex?: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (!gridRef.current) return;
      const rect = gridRef.current.getBoundingClientRect();
      // Total px used by resizer tracks: (cols-1) col tracks + (rows-1) row tracks.
      const gridWidth = rect.width - (cols - 1) * RESIZER_PX;
      const gridHeight = rect.height - (rows - 1) * RESIZER_PX;
      resizingState.current = {
        type,
        index,
        rowIndex,
        startPos: { x: e.clientX, y: e.clientY },
        startColSizes: [...colSizes],
        startRowSizes: [...rowSizes],
        gridSize: { width: gridWidth, height: gridHeight },
      };
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEndRef.current);
      document.body.style.cursor =
        type === 'col' ? 'col-resize' : type === 'row' ? 'row-resize' : 'move';
      const key =
        type === 'both' ? `x-${rowIndex}-${index}` : type === 'col' ? `v-${index}` : `h-${index}`;
      setActiveResizer(key);
    },
    [cols, rows, colSizes, rowSizes, handleResizeMove]
  );

  useEffect(() => {
    const endRef = handleResizeEndRef;
    return () => {
      if (resizingState.current) {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', endRef.current);
        document.body.style.cursor = '';
        resizingState.current = null;
      }
      if (resizeRafId.current !== null) {
        cancelAnimationFrame(resizeRafId.current);
        resizeRafId.current = null;
      }
    };
  }, [handleResizeMove]);

  const gridTemplateColumns = useMemo(
    () =>
      colSizes.length === cols
        ? colSizes.map((s) => `minmax(0, ${s}fr)`).join(` ${RESIZER_PX}px `)
        : `repeat(${cols}, minmax(0, 1fr))`,
    [colSizes, cols]
  );
  const gridTemplateRows = useMemo(
    () =>
      rowSizes.length === rows
        ? rowSizes.map((s) => `minmax(0, ${s}fr)`).join(` ${RESIZER_PX}px `)
        : `repeat(${rows}, minmax(0, 1fr))`,
    [rowSizes, rows]
  );

  const handleDragOver = (paneId: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-hotty-session')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPaneId(paneId);
  };

  const handleDragLeave = () => setDragOverPaneId(null);

  const handleDrop = (paneId: string) => (e: React.DragEvent) => {
    const sessionId = e.dataTransfer.getData('application/x-hotty-session');
    setDragOverPaneId(null);
    if (!sessionId) return;
    e.preventDefault();
    e.stopPropagation();
    onDropSession(sessionId, paneId);
  };

  return (
    <div
      className="grid-layout"
      ref={gridRef}
      style={{ gridTemplateColumns, gridTemplateRows }}
    >
      {paneIds.map((paneId, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        return (
          <div
            className={`grid-layout-cell${dragOverPaneId === paneId ? ' drop-target' : ''}`}
            key={paneId}
            data-pane-id={paneId}
            style={{ gridColumn: c * 2 + 1, gridRow: r * 2 + 1, ...cellBackgroundStyle }}
            onDragOver={handleDragOver(paneId)}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop(paneId)}
          >
            {renderPane(paneId)}
          </div>
        );
      })}

      {Array.from({ length: cols - 1 }, (_, c) => {
        const key = `v-${c}`;
        return (
          <div
            key={`resizer-${key}`}
            className={`grid-resizer-v${activeResizer === key ? ' resizing' : ''}`}
            style={{ gridColumn: c * 2 + 2, gridRow: '1 / -1' }}
            onMouseDown={(e) => handleResizeStart(e, 'col', c)}
            data-testid={`grid-resizer-v-${c}`}
          />
        );
      })}

      {Array.from({ length: rows - 1 }, (_, r) => {
        const key = `h-${r}`;
        return (
          <div
            key={`resizer-${key}`}
            className={`grid-resizer-h${activeResizer === key ? ' resizing' : ''}`}
            style={{ gridColumn: '1 / -1', gridRow: r * 2 + 2 }}
            onMouseDown={(e) => handleResizeStart(e, 'row', r)}
            data-testid={`grid-resizer-h-${r}`}
          />
        );
      })}

      {Array.from({ length: rows - 1 }, (_, r) =>
        Array.from({ length: cols - 1 }, (_, c) => {
          const key = `x-${r}-${c}`;
          return (
            <div
              key={`resizer-${key}`}
              className={`grid-resizer-cross${activeResizer === key ? ' resizing' : ''}`}
              style={{ gridColumn: c * 2 + 2, gridRow: r * 2 + 2 }}
              onMouseDown={(e) => handleResizeStart(e, 'both', c, r)}
              data-testid={`grid-resizer-cross-${r}-${c}`}
            />
          );
        })
      )}
    </div>
  );
}
