import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FileExplorerPane } from './FileExplorerPane';

// Mock electronService
vi.mock('../../services/electronService', () => ({
    fileExplorerGetDrives: vi.fn(() => Promise.resolve({ drives: ['C:\\', 'D:\\'], homedir: 'C:\\Users\\test' })),
    fileExplorerListDirectory: vi.fn(() => Promise.resolve({
        entries: [
            { name: 'Documents', isDirectory: true, size: 0, mtime: 1700000000000, isHidden: false },
            { name: 'readme.txt', isDirectory: false, size: 1234, mtime: 1700000000000, isHidden: false },
            { name: '.hidden', isDirectory: false, size: 100, mtime: 1700000000000, isHidden: true },
        ],
    })),
}));

// Mock @tanstack/react-virtual
vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
        getTotalSize: () => count * estimateSize(),
        getVirtualItems: () =>
            Array.from({ length: count }, (_, i) => ({
                index: i,
                start: i * estimateSize(),
                size: estimateSize(),
                key: i,
            })),
    }),
}));

import * as electronService from '../../services/electronService';

describe('FileExplorerPane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders and auto-expands to home directory on mount', async () => {
        await act(async () => {
            render(<FileExplorerPane sessionId="test-1" />);
        });
        expect(electronService.fileExplorerGetDrives).toHaveBeenCalled();
        // Drives should be visible
        expect(screen.getByText('C:\\')).toBeTruthy();
        expect(screen.getByText('D:\\')).toBeTruthy();
        // Home directory path segments should be loaded
        expect(electronService.fileExplorerListDirectory).toHaveBeenCalledWith('C:\\');
        expect(electronService.fileExplorerListDirectory).toHaveBeenCalledWith('C:\\Users');
        expect(electronService.fileExplorerListDirectory).toHaveBeenCalledWith('C:\\Users\\test');
    });

    it('shows directory contents after auto-expand', async () => {
        await act(async () => {
            render(<FileExplorerPane sessionId="test-1" />);
        });
        // Contents from the deepest expanded directory should be visible
        expect(screen.getAllByText('Documents').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('readme.txt').length).toBeGreaterThanOrEqual(1);
    });

    it('hides hidden files by default', async () => {
        await act(async () => {
            render(<FileExplorerPane sessionId="test-1" />);
        });
        expect(screen.queryByText('.hidden')).toBeNull();
    });

    it('shows hidden files when toggle clicked', async () => {
        await act(async () => {
            render(<FileExplorerPane sessionId="test-1" />);
        });

        // Initially hidden files are not shown; button says "Show hidden files"
        await act(async () => {
            fireEvent.click(screen.getByTitle('Show hidden files'));
        });

        expect(screen.getAllByText('.hidden').length).toBeGreaterThanOrEqual(1);
    });

    it('calls onOpenFile on double-click of a file', async () => {
        const onOpenFile = vi.fn();
        await act(async () => {
            render(<FileExplorerPane sessionId="test-1" onOpenFile={onOpenFile} />);
        });

        // readme.txt appears in multiple expanded dirs; double-click the first one
        const readmeElements = screen.getAllByText('readme.txt');
        await act(async () => {
            fireEvent.doubleClick(readmeElements[0]);
        });

        expect(onOpenFile).toHaveBeenCalled();
    });

    it('calls onStateChange during auto-expand', async () => {
        const onStateChange = vi.fn();
        await act(async () => {
            render(<FileExplorerPane sessionId="test-1" onStateChange={onStateChange} />);
        });

        // onStateChange should have been called with expanded paths including home dir segments
        expect(onStateChange).toHaveBeenCalled();
        const lastCall = onStateChange.mock.calls[onStateChange.mock.calls.length - 1][0];
        expect(lastCall.expandedPaths).toContain('C:\\');
        expect(lastCall.expandedPaths).toContain('C:\\Users');
        expect(lastCall.expandedPaths).toContain('C:\\Users\\test');
    });

    it('displays error when directory listing fails', async () => {
        vi.mocked(electronService.fileExplorerListDirectory).mockResolvedValue({
            error: 'Permission denied',
        });

        await act(async () => {
            render(<FileExplorerPane sessionId="test-1" />);
        });

        // Error indicator should be rendered for at least one directory
        const errorIndicators = screen.getAllByTitle('Permission denied');
        expect(errorIndicators.length).toBeGreaterThanOrEqual(1);
    });

    it('restores expanded paths from initial state instead of home dir', async () => {
        await act(async () => {
            render(
                <FileExplorerPane
                    sessionId="test-1"
                    initialState={{ currentPath: '', expandedPaths: ['D:\\'] }}
                />
            );
        });

        // Should load D:\ from saved state, not auto-expand to home
        expect(electronService.fileExplorerListDirectory).toHaveBeenCalledWith('D:\\');
    });

    it('refreshes on refresh button click', async () => {
        await act(async () => {
            render(<FileExplorerPane sessionId="test-1" />);
        });

        vi.clearAllMocks();

        await act(async () => {
            fireEvent.click(screen.getByTitle('Refresh'));
        });

        expect(electronService.fileExplorerGetDrives).toHaveBeenCalled();
    });

    it('does not show file size', async () => {
        await act(async () => {
            render(<FileExplorerPane sessionId="test-1" />);
        });

        expect(screen.queryByText('1.2 KB')).toBeNull();
    });
});
