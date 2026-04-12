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
  const [dropActive, setDropActive] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const host = ref.current?.parentElement;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      let pct = 20;
      if (edge === 'left') pct = ((e.clientX - rect.left) / rect.width) * 100;
      if (edge === 'right') pct = ((rect.right - e.clientX) / rect.width) * 100;
      if (edge === 'top') pct = ((e.clientY - rect.top) / rect.height) * 100;
      if (edge === 'bottom') pct = ((rect.bottom - e.clientY) / rect.height) * 100;
      setPercent(edge, pct);
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
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
        className={`sidebar-resize sidebar-resize-${edge}`}
        onMouseDown={onMouseDown}
      />
    </div>
  );
}
