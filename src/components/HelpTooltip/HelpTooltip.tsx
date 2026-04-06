import React, { useState, useRef, useCallback, useLayoutEffect } from 'react';
import ReactDOM from 'react-dom';
import './HelpTooltip.css';

interface HelpTooltipProps {
    text: React.ReactNode;
}

const TOOLTIP_GAP = 6;
const VIEWPORT_MARGIN = 8;

const HelpTooltip: React.FC<HelpTooltipProps> = ({ text }) => {
    const [visible, setVisible] = useState(false);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const iconRef = useRef<HTMLSpanElement>(null);
    const contentRef = useRef<HTMLSpanElement>(null);

    // Calculate position after portal is mounted in the DOM
    useLayoutEffect(() => {
        if (!visible) return;
        const icon = iconRef.current;
        const tip = contentRef.current;
        if (!icon || !tip) return;

        const iconRect = icon.getBoundingClientRect();
        const tipRect = tip.getBoundingClientRect();

        // Default: below the icon, centered horizontally on the icon
        let top = iconRect.bottom + TOOLTIP_GAP;
        let left = iconRect.left + iconRect.width / 2 - tipRect.width / 2;

        // Flip above if overflowing bottom
        if (top + tipRect.height > window.innerHeight - VIEWPORT_MARGIN) {
            top = iconRect.top - TOOLTIP_GAP - tipRect.height;
        }

        // Clamp horizontal to viewport
        if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
        if (left + tipRect.width > window.innerWidth - VIEWPORT_MARGIN) {
            left = window.innerWidth - VIEWPORT_MARGIN - tipRect.width;
        }

        // eslint-disable-next-line react-hooks/set-state-in-effect -- Portal tooltip must measure DOM position synchronously after mount
        setPos({ top, left });
    }, [visible]);

    const show = useCallback(() => {
        setPos(null);
        setVisible(true);
    }, []);

    const hide = useCallback(() => {
        setVisible(false);
        setPos(null);
    }, []);

    return (
        <span
            className="help-tooltip"
            onClick={e => e.preventDefault()}
            onMouseEnter={show}
            onMouseLeave={hide}
        >
            <span className="help-tooltip-icon" ref={iconRef}>?</span>
            {visible && ReactDOM.createPortal(
                <span
                    className="help-tooltip-content"
                    ref={contentRef}
                    style={pos
                        ? { top: pos.top, left: pos.left, visibility: 'visible' }
                        : { visibility: 'hidden' }
                    }
                >
                    {text}
                </span>,
                document.body
            )}
        </span>
    );
};

export default HelpTooltip;
