import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from './TabBar';

vi.mock('./TabBar.css', () => ({}));

describe('TabBar', () => {
    const sshTab = { id: 'tab1', title: 'SSH Host', type: 'ssh' as const };
    const aiTab = { id: 'tab2', title: 'Gemini AI', type: 'ai' as const };

    const baseProps = {
        tabs: [sshTab, aiTab],
        activeTabId: null,
        visibleSessionIds: ['tab1', 'tab2'],
        watchedSessionIds: [],
        onTabClick: vi.fn(),
        onTabClose: vi.fn(),
        onToggleWatch: vi.fn(),
        onNewTab: vi.fn(),
        onNewAITab: vi.fn(),
        onNewLogViewer: vi.fn(),
        onNewTextEditor: vi.fn(),
        onNewPingMonitor: vi.fn(),
        onTabReorder: vi.fn(),
        lastTargetSessionId: null,
    };

    it('renders tab titles', () => {
        render(<TabBar {...baseProps} />);
        expect(screen.getByText('SSH Host')).toBeInTheDocument();
        expect(screen.getByText('Gemini AI')).toBeInTheDocument();
    });

    it('active tab has "active" class', () => {
        const { container } = render(<TabBar {...baseProps} activeTabId="tab1" />);
        const tabs = container.querySelectorAll('.tab');
        // tab1 should have 'active' class
        expect(tabs[0]).toHaveClass('active');
        expect(tabs[1]).not.toHaveClass('active');
    });

    it('tab not in visibleSessionIds has "hidden-tab" class', () => {
        const { container } = render(
            <TabBar {...baseProps} visibleSessionIds={['tab2']} />
        );
        const tabs = container.querySelectorAll('.tab');
        expect(tabs[0]).toHaveClass('hidden-tab');
        expect(tabs[1]).not.toHaveClass('hidden-tab');
    });

    it('clicking a tab calls onTabClick with tab id', () => {
        const onTabClick = vi.fn();
        render(<TabBar {...baseProps} onTabClick={onTabClick} />);
        fireEvent.click(screen.getByText('SSH Host'));
        expect(onTabClick).toHaveBeenCalledWith('tab1');
    });

    it('clicking close button calls onTabClose and not onTabClick (stopPropagation)', () => {
        const onTabClose = vi.fn();
        const onTabClick = vi.fn();
        const { container } = render(
            <TabBar {...baseProps} onTabClose={onTabClose} onTabClick={onTabClick} />
        );
        const closeButtons = container.querySelectorAll('.tab-close');
        fireEvent.click(closeButtons[0]);
        expect(onTabClose).toHaveBeenCalledWith('tab1');
        expect(onTabClick).not.toHaveBeenCalled();
    });

    it('New Session button calls onNewTab', () => {
        const onNewTab = vi.fn();
        render(<TabBar {...baseProps} onNewTab={onNewTab} />);
        fireEvent.click(screen.getByTitle('New Session'));
        expect(onNewTab).toHaveBeenCalledTimes(1);
    });

    it('clicking Features button shows dropdown', () => {
        render(<TabBar {...baseProps} />);
        fireEvent.click(screen.getByTitle('Features').querySelector('.features-btn-icon')!);
        expect(screen.getByText('AI Chat')).toBeInTheDocument();
        expect(screen.getByText('Log Viewer')).toBeInTheDocument();
    });

    it('clicking "AI Chat" in dropdown calls onNewAITab', () => {
        const onNewAITab = vi.fn();
        render(<TabBar {...baseProps} onNewAITab={onNewAITab} />);
        fireEvent.click(screen.getByTitle('Features').querySelector('.features-btn-icon')!);
        fireEvent.click(screen.getByText('AI Chat'));
        expect(onNewAITab).toHaveBeenCalledTimes(1);
    });

    it('clicking "Log Viewer" in dropdown calls onNewLogViewer', () => {
        const onNewLogViewer = vi.fn();
        render(<TabBar {...baseProps} onNewLogViewer={onNewLogViewer} />);
        fireEvent.click(screen.getByTitle('Features').querySelector('.features-btn-icon')!);
        fireEvent.click(screen.getByText('Log Viewer'));
        expect(onNewLogViewer).toHaveBeenCalledTimes(1);
    });

    it('watch button appears for SSH tab (terminal type)', () => {
        const { container } = render(<TabBar {...baseProps} />);
        const watchBtns = container.querySelectorAll('.tab-watch-btn');
        // SSH tab is terminal, AI tab is not — only 1 watch button expected
        expect(watchBtns.length).toBe(1);
    });

    it('watch button not shown for AI tab', () => {
        const { container } = render(
            <TabBar {...baseProps} tabs={[aiTab]} visibleSessionIds={['tab2']} />
        );
        expect(container.querySelector('.tab-watch-btn')).toBeNull();
    });

    it('clicking watch button calls onToggleWatch', () => {
        const onToggleWatch = vi.fn();
        const { container } = render(
            <TabBar {...baseProps} onToggleWatch={onToggleWatch} />
        );
        const watchBtn = container.querySelector('.tab-watch-btn')!;
        fireEvent.click(watchBtn);
        expect(onToggleWatch).toHaveBeenCalledWith('tab1');
    });
});
