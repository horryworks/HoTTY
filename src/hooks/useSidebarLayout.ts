import { useState, useRef } from 'react';
import { useSidebarLayoutStore } from '../stores/sidebarLayoutStore';

export function useSidebarLayout() {
    const {
        showLeftSidebar, setShowLeftSidebar,
        showRightSidebar, setShowRightSidebar,
        showTopBar, setShowTopBar,
        showBottomBar, setShowBottomBar,
        leftSidebarPercent,
        rightSidebarPercent,
        topBarPercent,
        bottomBarPercent,
    } = useSidebarLayoutStore();

    const [resizingSide, setResizingSide] = useState<'left' | 'right' | 'top' | 'bottom' | null>(null);

    const sidebarResizingState = useRef<{
        side: 'left' | 'right' | 'top' | 'bottom';
        startPos: number;
        startPercent: number;
        containerSize: number;
    } | null>(null);

    const handleSidebarResizeMove = (e: MouseEvent) => {
        if (!sidebarResizingState.current) return;
        const { side, startPos, startPercent, containerSize } = sidebarResizingState.current;
        // Use getState() to avoid stale closure in native DOM listeners
        const store = useSidebarLayoutStore.getState();

        if (side === 'left' || side === 'right') {
            const deltaPx = side === 'left' ? e.clientX - startPos : startPos - e.clientX;
            const deltaPercent = (deltaPx / containerSize) * 100;
            const newPercent = Math.max(5, Math.min(80, startPercent + deltaPercent));
            if (side === 'left') store.setLeftSidebarPercent(newPercent);
            else store.setRightSidebarPercent(newPercent);
        } else {
            const deltaPx = side === 'top' ? e.clientY - startPos : startPos - e.clientY;
            const deltaPercent = (deltaPx / containerSize) * 100;
            const newPercent = Math.max(5, Math.min(80, startPercent + deltaPercent));
            if (side === 'top') store.setTopBarPercent(newPercent);
            else store.setBottomBarPercent(newPercent);
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
            containerSize: side === 'left' || side === 'right' ? containerWidth : containerHeight,
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
