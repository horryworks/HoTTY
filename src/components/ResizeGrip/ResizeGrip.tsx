import React, { useState, useEffect } from 'react';
import * as electronService from '../../services/electronService';

export const ResizeGrip: React.FC = () => {
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;

            // clientX/Y is the mouse position within the viewport, which equals
            // the desired window dimensions when dragging from the bottom-right corner.
            electronService.setWindowSize(e.clientX, e.clientY);
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
                    var(--resize-grip-shadow) 4px,
                    var(--resize-grip-shadow) 7px
                )`,
                clipPath: 'polygon(100% 0, 100% 100%, 0 100%)', // Triangle shape
            }}
            title="Drag to resize"
        />
    );
};
