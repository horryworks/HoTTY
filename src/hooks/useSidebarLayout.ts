import { useState, useRef, useEffect } from 'react';
import { STORAGE_KEYS } from '../constants/storage';

export function useSidebarLayout() {
  const [showLeftSidebar, setShowLeftSidebar] = useState(() => localStorage.getItem(STORAGE_KEYS.UI_SHOW_LEFT_SIDEBAR) === 'true');
  const [showRightSidebar, setShowRightSidebar] = useState(() => localStorage.getItem(STORAGE_KEYS.UI_SHOW_RIGHT_SIDEBAR) === 'true');
  const [showTopBar, setShowTopBar] = useState(() => localStorage.getItem(STORAGE_KEYS.UI_SHOW_TOP_BAR) === 'true');
  const [showBottomBar, setShowBottomBar] = useState(() => localStorage.getItem(STORAGE_KEYS.UI_SHOW_BOTTOM_BAR) === 'true');

  const [leftSidebarPercent, setLeftSidebarPercent] = useState(() => parseFloat(localStorage.getItem(STORAGE_KEYS.UI_LEFT_SIDEBAR_PCT) || '20'));
  const [rightSidebarPercent, setRightSidebarPercent] = useState(() => parseFloat(localStorage.getItem(STORAGE_KEYS.UI_RIGHT_SIDEBAR_PCT) || '20'));
  const [topBarPercent, setTopBarPercent] = useState(() => parseFloat(localStorage.getItem(STORAGE_KEYS.UI_TOP_BAR_PCT) || '20'));
  const [bottomBarPercent, setBottomBarPercent] = useState(() => parseFloat(localStorage.getItem(STORAGE_KEYS.UI_BOTTOM_BAR_PCT) || '20'));

  const [resizingSide, setResizingSide] = useState<'left' | 'right' | 'top' | 'bottom' | null>(null);

  useEffect(() => localStorage.setItem(STORAGE_KEYS.UI_SHOW_LEFT_SIDEBAR, String(showLeftSidebar)), [showLeftSidebar]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.UI_SHOW_RIGHT_SIDEBAR, String(showRightSidebar)), [showRightSidebar]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.UI_SHOW_TOP_BAR, String(showTopBar)), [showTopBar]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.UI_SHOW_BOTTOM_BAR, String(showBottomBar)), [showBottomBar]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.UI_LEFT_SIDEBAR_PCT, String(leftSidebarPercent)), [leftSidebarPercent]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.UI_RIGHT_SIDEBAR_PCT, String(rightSidebarPercent)), [rightSidebarPercent]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.UI_TOP_BAR_PCT, String(topBarPercent)), [topBarPercent]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.UI_BOTTOM_BAR_PCT, String(bottomBarPercent)), [bottomBarPercent]);

  const sidebarResizingState = useRef<{
    side: 'left' | 'right' | 'top' | 'bottom';
    startPos: number;
    startPercent: number;
    containerSize: number;
  } | null>(null);

  const handleSidebarResizeMove = (e: MouseEvent) => {
    if (!sidebarResizingState.current) return;
    const { side, startPos, startPercent, containerSize } = sidebarResizingState.current;

    if (side === 'left' || side === 'right') {
      const deltaPx = side === 'left' ? e.clientX - startPos : startPos - e.clientX;
      const deltaPercent = (deltaPx / containerSize) * 100;
      const newPercent = Math.max(5, Math.min(80, startPercent + deltaPercent));
      if (side === 'left') setLeftSidebarPercent(newPercent);
      else setRightSidebarPercent(newPercent);
    } else {
      const deltaPx = side === 'top' ? e.clientY - startPos : startPos - e.clientY;
      const deltaPercent = (deltaPx / containerSize) * 100;
      const newPercent = Math.max(5, Math.min(80, startPercent + deltaPercent));
      if (side === 'top') setTopBarPercent(newPercent);
      else setBottomBarPercent(newPercent);
    }
  };

  const handleSidebarResizeEnd = () => {
    sidebarResizingState.current = null;
    setResizingSide(null);
    document.removeEventListener('mousemove', handleSidebarResizeMove);
    document.removeEventListener('mouseup', handleSidebarResizeEnd);
    document.body.style.cursor = '';
  };

  const handleResizeStart = (e: React.MouseEvent, side: 'left' | 'right' | 'top' | 'bottom') => {
    e.preventDefault();
    e.stopPropagation();
    setResizingSide(side);

    const container = document.querySelector('.app-container');
    const centerColumn = document.querySelector('.center-column');
    const containerWidth = container ? container.clientWidth : window.innerWidth;
    const containerHeight = centerColumn ? centerColumn.clientHeight : window.innerHeight;

    sidebarResizingState.current = {
      side,
      startPos: side === 'left' || side === 'right' ? e.clientX : e.clientY,
      startPercent: side === 'left' ? leftSidebarPercent
        : side === 'right' ? rightSidebarPercent
          : side === 'top' ? topBarPercent
            : bottomBarPercent,
      containerSize: side === 'left' || side === 'right' ? containerWidth : containerHeight
    };

    document.addEventListener('mousemove', handleSidebarResizeMove);
    document.addEventListener('mouseup', handleSidebarResizeEnd);
    document.body.style.cursor = (side === 'left' || side === 'right') ? 'col-resize' : 'row-resize';
  };

  return {
    showLeftSidebar, setShowLeftSidebar,
    showRightSidebar, setShowRightSidebar,
    showTopBar, setShowTopBar,
    showBottomBar, setShowBottomBar,
    leftSidebarPercent,
    rightSidebarPercent,
    topBarPercent,
    bottomBarPercent,
    resizingSide,
    handleResizeStart,
  };
}
