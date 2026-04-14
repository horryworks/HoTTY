import { useState, useCallback, useEffect, useRef } from 'react';

type ResizeOrientation = 'horizontal' | 'vertical' | 'both';

interface UseResizeOptions {
    onMove: (dx: number, dy: number) => void;
    orientation?: ResizeOrientation;
    cursor?: string;
}

interface UseResizeReturn {
    startResize: (e: React.MouseEvent) => void;
    isResizing: boolean;
}

export function useResize({ onMove, orientation = 'both', cursor }: UseResizeOptions): UseResizeReturn {
    const [isResizing, setIsResizing] = useState(false);
    const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const onMoveRef = useRef(onMove);
    onMoveRef.current = onMove;
    const cleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        return () => {
            cleanupRef.current?.();
        };
    }, []);

    const getCursor = () => {
        if (cursor) return cursor;
        if (orientation === 'horizontal') return 'col-resize';
        if (orientation === 'vertical') return 'row-resize';
        return 'move';
    };

    const startResize = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        startPosRef.current = { x: e.clientX, y: e.clientY };
        setIsResizing(true);
        document.body.style.cursor = getCursor();

        const handleMouseMove = (ev: MouseEvent) => {
            const dx = ev.clientX - startPosRef.current.x;
            const dy = ev.clientY - startPosRef.current.y;
            const effectiveDx = orientation === 'vertical' ? 0 : dx;
            const effectiveDy = orientation === 'horizontal' ? 0 : dy;
            onMoveRef.current(effectiveDx, effectiveDy);
        };

        const cleanup = () => {
            setIsResizing(false);
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            cleanupRef.current = null;
        };

        const handleMouseUp = () => {
            cleanup();
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        cleanupRef.current = cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orientation, cursor]);

    return { startResize, isResizing };
}
