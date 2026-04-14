import { useCallback, useEffect, useRef, useState } from 'react';
import { useSidebarLayoutStore, type SidebarEdge } from '../../stores/sidebarLayoutStore';
import './Sidebar.css';

interface SidebarProps {
  edge: SidebarEdge;
  children?: React.ReactNode;
  onDropSession?: (sessionId: string) => void;
}

export function Sidebar({ edge, children, onDropSession }: SidebarProps) {
  const state = useSidebarLayoutStore();
  const setPercent = state.setPercent;

  const visible =
    edge === 'left'
      ? state.showLeftSidebar
      : edge === 'right'
      ? state.showRightSidebar
      : edge === 'top'
      ? state.showTopBar
      : state.showBottomBar;

  const percent =
    edge === 'left'
      ? state.leftSidebarPercent
      : edge === 'right'
      ? state.rightSidebarPercent
      : edge === 'top'
      ? state.topBarPercent
      : state.bottomBarPercent;

  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const rafId = useRef<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragging.current = true;
      setIsResizing(true);
      document.body.style.cursor =
        edge === 'left' || edge === 'right' ? 'col-resize' : 'row-resize';
    },
    [edge]
  );

  useEffect(() => {
    if (!visible) return;
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      if (rafId.current !== null) return;
      const clientX = e.clientX;
      const clientY = e.clientY;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (!dragging.current) return;
        const host = ref.current?.parentElement;
        if (!host) return;
        const rect = host.getBoundingClientRect();
        let pct = 20;
        if (edge === 'left') pct = ((clientX - rect.left) / rect.width) * 100;
        if (edge === 'right') pct = ((rect.right - clientX) / rect.width) * 100;
        if (edge === 'top') pct = ((clientY - rect.top) / rect.height) * 100;
        if (edge === 'bottom') pct = ((rect.bottom - clientY) / rect.height) * 100;
        setPercent(edge, pct);
      });
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      setIsResizing(false);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
      }
    };
  }, [edge, setPercent, visible]);

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-hotty-session')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropActive(true);
  };

  const handleDragLeave = () => setDropActive(false);

  const handleDrop = (e: React.DragEvent) => {
    const sessionId = e.dataTransfer.getData('application/x-hotty-session');
    setDropActive(false);
    if (!sessionId) return;
    e.preventDefault();
    e.stopPropagation();
    onDropSession?.(sessionId);
  };

  if (!visible) return null;

  const styleDim =
    edge === 'left' || edge === 'right'
      ? { width: `${percent}%` }
      : { height: `${percent}%` };

  return (
    <div
      className={`sidebar sidebar-${edge}${dropActive ? ' drop-target' : ''}`}
      ref={ref}
      style={styleDim}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="sidebar-content">{children}</div>
      <div
        className={`sidebar-resize sidebar-resize-${edge}${isResizing ? ' resizing' : ''}`}
        onMouseDown={onMouseDown}
      />
    </div>
  );
}
