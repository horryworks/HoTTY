import React, { useState, useEffect } from 'react';

export const ResizeGrip: React.FC = () => {
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;

            // Calculate new size based on mouse position
            // Since the grip is at the bottom right, the mouse position roughly corresponds to the window size relative to top-left (0,0)
            // But 'e.screenX/Y' are global. 'e.clientX/Y' are client area.
            // We want the window size to follow the mouse.
            // However, e.clientX/Y is relative to the window content area. 
            // If we resize the window, the coordinate system changes? 
            // Actually, if we use window.outerWidth/Height and adding delta, it's safer.

            // Wait, simpler approach:
            // Mouse absolute position on screen? No, security restriction.

            // If we assume the mouse pointer is *on* the bottom right corner when dragging:
            // usage: window.resizeTo(e.screenX - window.screenX, e.screenY - window.screenY) ?
            // Electron's setSize takes total width/height.

            // Let's rely on movement. 
            // But for a custom grip, typically you just resize to (e.clientX + offset, e.clientY + offset) if e.clientX is within the window.
            // e.clientX is the X coordinate within the viewport.
            // So width = e.clientX, height = e.clientY ?
            // Nearly, plus any offset from the grip center to the edge.

            // Let's try setting size to (e.clientX, e.clientY). 
            // Since the event is fired on window, and we are dragging *the corner*, 
            // the mouse should effectively be at the new width/height boundaries.

            // Throttle this? Electron IPC is fast enough usually.
            window.electronAPI.setWindowSize(e.clientX, e.clientY);
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    return (
        <div
            onMouseDown={() => setIsDragging(true)}
            style={{
                position: 'fixed',
                bottom: '2px',
                right: '2px',
                width: '16px',
                height: '16px',
                cursor: 'se-resize', // South-East resize cursor
                zIndex: 9999,
                background: `repeating-linear-gradient(
                    -45deg,
                    transparent,
                    transparent 4px,
                    rgba(255, 255, 255, 0.8) 4px,
                    rgba(255, 255, 255, 0.8) 7px
                )`,
                clipPath: 'polygon(100% 0, 100% 100%, 0 100%)', // Triangle shape
            }}
            title="Drag to resize"
        />
    );
};
