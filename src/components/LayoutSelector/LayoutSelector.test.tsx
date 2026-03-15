import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayoutSelector } from './LayoutSelector';

vi.mock('./LayoutSelector.css', () => ({}));

describe('LayoutSelector', () => {
    const baseProps = {
        currentLayout: '1x1' as const,
        onLayoutChange: vi.fn(),
        showLeftSidebar: false,
        showRightSidebar: false,
        showTopBar: false,
        showBottomBar: false,
        onToggleLeftSidebar: vi.fn(),
        onToggleRightSidebar: vi.fn(),
        onToggleTopBar: vi.fn(),
        onToggleBottomBar: vi.fn(),
    };

    it('renders layout options with correct titles', () => {
        render(<LayoutSelector {...baseProps} />);
        expect(screen.getByTitle('Single (1x1)')).toBeInTheDocument();
        expect(screen.getByTitle('Split Vertical (1x2)')).toBeInTheDocument();
        expect(screen.getByTitle('Split Horizontal (2x1)')).toBeInTheDocument();
        expect(screen.getByTitle('Grid (2x2)')).toBeInTheDocument();
        expect(screen.getByTitle('Grid (2x3)')).toBeInTheDocument();
        expect(screen.getByTitle('Grid (3x2)')).toBeInTheDocument();
    });

    it('currently selected layout has "selected" class', () => {
        render(<LayoutSelector {...baseProps} currentLayout="1x2" />);
        expect(screen.getByTitle('Split Vertical (1x2)')).toHaveClass('selected');
        expect(screen.getByTitle('Single (1x1)')).not.toHaveClass('selected');
    });

    it('clicking "Single (1x1)" calls onLayoutChange with "1x1"', () => {
        const onLayoutChange = vi.fn();
        render(<LayoutSelector {...baseProps} onLayoutChange={onLayoutChange} />);
        fireEvent.click(screen.getByTitle('Single (1x1)'));
        expect(onLayoutChange).toHaveBeenCalledWith('1x1');
    });

    it('clicking "Split Vertical (1x2)" calls onLayoutChange with "1x2"', () => {
        const onLayoutChange = vi.fn();
        render(<LayoutSelector {...baseProps} onLayoutChange={onLayoutChange} />);
        fireEvent.click(screen.getByTitle('Split Vertical (1x2)'));
        expect(onLayoutChange).toHaveBeenCalledWith('1x2');
    });

    it('Toggle Left Sidebar button has "selected" class when showLeftSidebar=true', () => {
        render(<LayoutSelector {...baseProps} showLeftSidebar={true} />);
        expect(screen.getByTitle('Toggle Left Sidebar')).toHaveClass('selected');
    });

    it('clicking toggle left sidebar calls onToggleLeftSidebar', () => {
        const onToggleLeftSidebar = vi.fn();
        render(<LayoutSelector {...baseProps} onToggleLeftSidebar={onToggleLeftSidebar} />);
        fireEvent.click(screen.getByTitle('Toggle Left Sidebar'));
        expect(onToggleLeftSidebar).toHaveBeenCalledTimes(1);
    });

    it('clicking toggle right sidebar calls onToggleRightSidebar', () => {
        const onToggleRightSidebar = vi.fn();
        render(<LayoutSelector {...baseProps} onToggleRightSidebar={onToggleRightSidebar} />);
        fireEvent.click(screen.getByTitle('Toggle Right Sidebar'));
        expect(onToggleRightSidebar).toHaveBeenCalledTimes(1);
    });
});
