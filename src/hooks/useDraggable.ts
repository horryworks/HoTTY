import { useState, useCallback, useEffect } from 'react';

interface Position {
    x: number;
    y: number;
}

export const useDraggable = (initialPosition: Position = { x: 0, y: 0 }) => {
    const [position, setPosition] = useState<Position>(initialPosition);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState<Position>({ x: 0, y: 0 });

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        // Only left click
        if (e.button !== 0) return;

        // Prevent dragging if clicking on an interactive element inside the header
        const target = e.target as HTMLElement;
        if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'A') {
            return;
        }

        setIsDragging(true);
        setDragStart({
            x: e.clientX - position.x,
            y: e.clientY - position.y,
        });

        // Prevent text selection while dragging
        document.body.style.userSelect = 'none';
    }, [position]);

    const onMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging) return;

        const newX = e.clientX - dragStart.x;
        const newY = e.clientY - dragStart.y;

        setPosition({ x: newX, y: newY });
    }, [isDragging, dragStart]);

    const onMouseUp = useCallback(() => {
        setIsDragging(false);
        document.body.style.userSelect = '';
    }, []);

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        } else {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [isDragging, onMouseMove, onMouseUp]);

    return {
        position,
        onMouseDown,
        isDragging
    };
};
