import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PaneLines } from './PaneLines';

vi.mock('./PaneLines.css', () => ({}));

describe('PaneLines', () => {
    it('renders without crashing with valid props', () => {
        const { container } = render(
            <PaneLines paneAllocations={{ '0': 's1' }} totalPanes={1} visible={true} />
        );
        expect(container).toBeTruthy();
    });

    it('renders null when visible is false (no lines, component returns null)', () => {
        const { container } = render(
            <PaneLines paneAllocations={{ '0': 's1' }} totalPanes={1} visible={false} />
        );
        // When visible=false, lines are cleared → component returns null
        expect(container.firstChild).toBeNull();
    });

    it('renders null when visible is true but no DOM elements exist for tabs/panes (jsdom has no layout)', () => {
        // In jsdom, getBoundingClientRect returns all zeros, so no lines are drawn
        // and the component returns null (lines.length === 0 guard)
        const { container } = render(
            <PaneLines paneAllocations={{}} totalPanes={1} visible={true} />
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders without crashing with sidebar pane ids', () => {
        const { container } = render(
            <PaneLines
                paneAllocations={{ 'sidebar-left': 's1', '0': 's2' }}
                totalPanes={1}
                visible={true}
                showLeftSidebar={true}
                showRightSidebar={false}
                showTopBar={false}
                showBottomBar={false}
            />
        );
        expect(container).toBeTruthy();
    });

    it('renders without crashing with multiple panes', () => {
        const { container } = render(
            <PaneLines
                paneAllocations={{ '0': 's1', '1': 's2', '2': null, '3': 's3' }}
                totalPanes={4}
                visible={true}
            />
        );
        expect(container).toBeTruthy();
    });
});
