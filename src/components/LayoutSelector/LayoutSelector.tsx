import React from 'react';
import './LayoutSelector.css';

export type LayoutMode = '1x1' | '1x2' | '2x1' | '2x2' | '2x3' | '3x2';

interface LayoutSelectorProps {
    currentLayout: LayoutMode;
    onLayoutChange: (mode: LayoutMode) => void;
}

export const LayoutSelector: React.FC<LayoutSelectorProps> = ({ currentLayout, onLayoutChange }) => {
    return (
        <div className="layout-selector">
            <div className={`layout-option ${currentLayout === '1x1' ? 'selected' : ''}`} onClick={() => onLayoutChange('1x1')} title="Single (1x1)">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="20" height="20" rx="2" />
                </svg>
            </div>
            <div className={`layout-option ${currentLayout === '1x2' ? 'selected' : ''}`} onClick={() => onLayoutChange('1x2')} title="Split Vertical (1x2)">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="20" height="20" rx="2" />
                    <line x1="12" y1="2" x2="12" y2="22" />
                </svg>
            </div>
            <div className={`layout-option ${currentLayout === '2x1' ? 'selected' : ''}`} onClick={() => onLayoutChange('2x1')} title="Split Horizontal (2x1)">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="20" height="20" rx="2" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                </svg>
            </div>
            <div className={`layout-option ${currentLayout === '2x2' ? 'selected' : ''}`} onClick={() => onLayoutChange('2x2')} title="Grid (2x2)">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="20" height="20" rx="2" />
                    <line x1="12" y1="2" x2="12" y2="22" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                </svg>
            </div>
            <div className={`layout-option ${currentLayout === '2x3' ? 'selected' : ''}`} onClick={() => onLayoutChange('2x3')} title="Grid (2x3)">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="20" height="20" rx="2" />
                    <line x1="8.6" y1="2" x2="8.6" y2="22" />
                    <line x1="15.3" y1="2" x2="15.3" y2="22" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                </svg>
            </div>
            <div className={`layout-option ${currentLayout === '3x2' ? 'selected' : ''}`} onClick={() => onLayoutChange('3x2')} title="Grid (3x2)">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="20" height="20" rx="2" />
                    <line x1="12" y1="2" x2="12" y2="22" />
                    <line x1="2" y1="8.6" x2="22" y2="8.6" />
                    <line x1="2" y1="15.3" x2="22" y2="15.3" />
                </svg>
            </div>
        </div>
    );
};
