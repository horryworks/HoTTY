import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TextEditorPane } from './TextEditorPane';
import * as electronService from '../../services/electronService';

// Mock electronService
vi.mock('../../services/electronService', () => ({
    textEditorOpenFile: vi.fn(),
    textEditorSaveFile: vi.fn(),
    textEditorReadFile: vi.fn(),
    textEditorWriteFile: vi.fn(),
    textEditorApproveDroppedFile: vi.fn().mockResolvedValue(true),
    getFilePath: vi.fn((file: File) => (file as File & { _testPath?: string })._testPath || ''),
}));

// Mock useSettings
const mockUseSettings = vi.fn(() => ({
    settings: { lineWrapEnabled: false },
}));
vi.mock('../../hooks/useSettings', () => ({
    useSettings: () => mockUseSettings(),
}));

// Mock ResizeObserver (not available in jsdom)
vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
});

// Mock crypto.randomUUID
let uuidCounter = 0;
vi.stubGlobal('crypto', { randomUUID: () => `test-uuid-${++uuidCounter}` });

describe('TextEditorPane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        uuidCounter = 0;
        mockUseSettings.mockReturnValue({ settings: { lineWrapEnabled: false } });
    });

    it('renders with default empty state', () => {
        render(<TextEditorPane sessionId="test-1" />);
        expect(screen.getByText('File')).toBeTruthy();
        expect(screen.getByText('Edit')).toBeTruthy();
        expect(screen.getByText('View')).toBeTruthy();
        expect(screen.getByText('Ln 1, Col 1')).toBeTruthy();
        expect(screen.getByText('CRLF')).toBeTruthy();
        expect(screen.getByText('UTF-8')).toBeTruthy();
    });

    it('renders with initial multi-tab state', () => {
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [{
                        id: 'tab-1',
                        filePath: 'C:\\test.txt',
                        content: 'Hello\nWorld',
                        savedContent: 'Hello\nWorld',
                        encoding: 'utf-8',
                        lineEnding: 'LF',
                    }],
                    activeTabId: 'tab-1',
                }}
            />
        );
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(textarea.value).toBe('Hello\nWorld');
        expect(screen.getByText('LF')).toBeTruthy();
    });

    it('renders sub-tab with filename', () => {
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [{
                        id: 'tab-1',
                        filePath: 'C:\\folder\\myfile.txt',
                        content: 'content',
                        savedContent: 'content',
                        encoding: 'utf-8',
                        lineEnding: 'CRLF',
                    }],
                    activeTabId: 'tab-1',
                }}
            />
        );
        expect(screen.getByText('myfile.txt')).toBeTruthy();
    });

    it('renders multiple sub-tabs', () => {
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [
                        {
                            id: 'tab-1',
                            filePath: 'C:\\file1.txt',
                            content: 'content1',
                            savedContent: 'content1',
                            encoding: 'utf-8',
                            lineEnding: 'CRLF',
                        },
                        {
                            id: 'tab-2',
                            filePath: 'C:\\file2.txt',
                            content: 'content2',
                            savedContent: 'content2',
                            encoding: 'utf-8',
                            lineEnding: 'LF',
                        },
                    ],
                    activeTabId: 'tab-1',
                }}
            />
        );
        expect(screen.getByText('file1.txt')).toBeTruthy();
        expect(screen.getByText('file2.txt')).toBeTruthy();
    });

    it('switches between sub-tabs', () => {
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [
                        {
                            id: 'tab-1',
                            filePath: null,
                            content: 'content1',
                            savedContent: 'content1',
                            encoding: 'utf-8',
                            lineEnding: 'CRLF',
                        },
                        {
                            id: 'tab-2',
                            filePath: null,
                            content: 'content2',
                            savedContent: 'content2',
                            encoding: 'utf-8',
                            lineEnding: 'LF',
                        },
                    ],
                    activeTabId: 'tab-1',
                }}
            />
        );
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(textarea.value).toBe('content1');

        // Click on second tab (find Untitled tabs - both are Untitled)
        const untitledTabs = screen.getAllByText('Untitled');
        fireEvent.click(untitledTabs[1]); // Click second Untitled tab
        const textarea2 = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(textarea2.value).toBe('content2');
    });

    it('updates content on textarea change', () => {
        const onStateChange = vi.fn();
        render(
            <TextEditorPane
                sessionId="test-1"
                onStateChange={onStateChange}
            />
        );
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'new content' } });
        expect(onStateChange).toHaveBeenCalled();
        const call = onStateChange.mock.calls[0][0];
        expect(call.tabs[0].content).toBe('new content');
    });

    it('opens File menu on click', () => {
        render(<TextEditorPane sessionId="test-1" />);
        fireEvent.click(screen.getByText('File'));
        expect(screen.getByText('New Tab')).toBeTruthy();
        expect(screen.getByText('Open...')).toBeTruthy();
        expect(screen.getByText('Save')).toBeTruthy();
        expect(screen.getByText('Save As...')).toBeTruthy();
        expect(screen.getByText('Close Tab')).toBeTruthy();
    });

    it('opens Edit menu on click', () => {
        render(<TextEditorPane sessionId="test-1" />);
        fireEvent.click(screen.getByText('Edit'));
        expect(screen.getByText('Undo')).toBeTruthy();
        expect(screen.getByText('Redo')).toBeTruthy();
        expect(screen.getByText('Find')).toBeTruthy();
        expect(screen.getByText('Replace')).toBeTruthy();
        expect(screen.getByText('Go to Line...')).toBeTruthy();
    });

    it('shows find bar when Find is clicked from Edit menu', () => {
        render(<TextEditorPane sessionId="test-1" />);
        fireEvent.click(screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Find'));
        expect(screen.getByPlaceholderText('Search...')).toBeTruthy();
    });

    it('shows replace fields when Replace is clicked from Edit menu', () => {
        render(<TextEditorPane sessionId="test-1" />);
        fireEvent.click(screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Replace'));
        expect(screen.getByPlaceholderText('Search...')).toBeTruthy();
        expect(screen.getByPlaceholderText('Replace...')).toBeTruthy();
    });

    it('shows go to line dialog when Go to Line is clicked', () => {
        render(<TextEditorPane sessionId="test-1" />);
        fireEvent.click(screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Go to Line...'));
        expect(screen.getByText(/Go to Line/)).toBeTruthy();
    });

    it('shows line numbers matching content lines', () => {
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [{
                        id: 'tab-1',
                        filePath: null,
                        content: 'line1\nline2\nline3',
                        savedContent: '',
                        encoding: 'utf-8',
                        lineEnding: 'CRLF',
                    }],
                    activeTabId: 'tab-1',
                }}
            />
        );
        expect(screen.getByText('1')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
    });

    it('handles New Tab from File menu', () => {
        const onStateChange = vi.fn();
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [{
                        id: 'tab-1',
                        filePath: 'C:\\test.txt',
                        content: 'some content',
                        savedContent: 'some content',
                        encoding: 'utf-8',
                        lineEnding: 'CRLF',
                    }],
                    activeTabId: 'tab-1',
                }}
                onStateChange={onStateChange}
            />
        );
        fireEvent.click(screen.getByText('File'));
        fireEvent.click(screen.getByText('New Tab'));
        // Should have 2 tabs now
        const call = onStateChange.mock.calls[onStateChange.mock.calls.length - 1][0];
        expect(call.tabs.length).toBe(2);
    });

    it('toggles line ending picker', () => {
        render(<TextEditorPane sessionId="test-1" />);
        fireEvent.click(screen.getByText('CRLF'));
        expect(screen.getByText('LF')).toBeTruthy();
    });

    it('toggles encoding picker', () => {
        render(<TextEditorPane sessionId="test-1" />);
        fireEvent.click(screen.getByText('UTF-8'));
        expect(screen.getByText('ASCII')).toBeTruthy();
        expect(screen.getByText('LATIN1')).toBeTruthy();
    });

    it('shows dirty indicator on modified sub-tab', () => {
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [{
                        id: 'tab-1',
                        filePath: 'C:\\test.txt',
                        content: 'modified',
                        savedContent: 'original',
                        encoding: 'utf-8',
                        lineEnding: 'CRLF',
                    }],
                    activeTabId: 'tab-1',
                }}
            />
        );
        // Dirty indicator (●) should be visible
        expect(screen.getByText('\u25CF')).toBeTruthy();
    });

    it('shows + button to add new sub-tab', () => {
        render(<TextEditorPane sessionId="test-1" />);
        const addBtn = screen.getByTitle('New Tab');
        expect(addBtn).toBeTruthy();
    });

    it('shows drop overlay on drag enter with files', () => {
        const { container } = render(<TextEditorPane sessionId="test-1" />);
        const pane = container.querySelector('.text-editor-pane')!;
        fireEvent.dragEnter(pane, {
            dataTransfer: { types: ['Files'], files: [] },
        });
        expect(container.querySelector('.text-editor-drop-overlay')).toBeTruthy();
        expect(screen.getByText('Drop files here to open')).toBeTruthy();
    });

    it('hides drop overlay on drag leave', () => {
        const { container } = render(<TextEditorPane sessionId="test-1" />);
        const pane = container.querySelector('.text-editor-pane')!;
        fireEvent.dragEnter(pane, {
            dataTransfer: { types: ['Files'], files: [] },
        });
        expect(container.querySelector('.text-editor-drop-overlay')).toBeTruthy();
        fireEvent.dragLeave(pane, {
            dataTransfer: { types: ['Files'], files: [] },
        });
        expect(container.querySelector('.text-editor-drop-overlay')).toBeFalsy();
    });

    it('opens dropped file as new tab', async () => {
        vi.mocked(electronService.textEditorReadFile).mockResolvedValue({
            content: 'dropped content',
            lineEnding: 'LF',
        });
        const onStateChange = vi.fn();
        const { container } = render(
            <TextEditorPane sessionId="test-1" onStateChange={onStateChange} />
        );
        const pane = container.querySelector('.text-editor-pane')!;
        const file = new File([''], 'dropped.txt');
        Object.defineProperty(file, '_testPath', { value: 'C:\\dropped.txt' });

        await act(async () => {
            fireEvent.drop(pane, {
                dataTransfer: { files: [file], types: ['Files'] },
            });
        });

        expect(electronService.textEditorReadFile).toHaveBeenCalledWith('C:\\dropped.txt', 'utf-8');
        const lastCall = onStateChange.mock.calls[onStateChange.mock.calls.length - 1][0];
        expect(lastCall.tabs.some((t: { filePath: string | null }) => t.filePath === 'C:\\dropped.txt')).toBe(true);
    });

    it('activates existing tab when dropping already-open file', async () => {
        const onStateChange = vi.fn();
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [
                        {
                            id: 'tab-1',
                            filePath: 'C:\\existing.txt',
                            content: 'existing',
                            savedContent: 'existing',
                            encoding: 'utf-8',
                            lineEnding: 'CRLF',
                        },
                        {
                            id: 'tab-2',
                            filePath: null,
                            content: '',
                            savedContent: '',
                            encoding: 'utf-8',
                            lineEnding: 'CRLF',
                        },
                    ],
                    activeTabId: 'tab-2',
                }}
                onStateChange={onStateChange}
            />
        );
        const pane = document.querySelector('.text-editor-pane')!;
        const file = new File([''], 'existing.txt');
        Object.defineProperty(file, '_testPath', { value: 'C:\\existing.txt' });

        await act(async () => {
            fireEvent.drop(pane, {
                dataTransfer: { files: [file], types: ['Files'] },
            });
        });

        // Should switch tab, not read file again
        expect(electronService.textEditorReadFile).not.toHaveBeenCalled();
        // activeTabId should be set to tab-1
        expect(onStateChange).toHaveBeenCalledWith({ activeTabId: 'tab-1' });
    });

    it('reorders tabs via drag and drop', () => {
        const onStateChange = vi.fn();
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [
                        { id: 'tab-1', filePath: 'C:\\a.txt', content: 'a', savedContent: 'a', encoding: 'utf-8', lineEnding: 'CRLF' },
                        { id: 'tab-2', filePath: 'C:\\b.txt', content: 'b', savedContent: 'b', encoding: 'utf-8', lineEnding: 'CRLF' },
                        { id: 'tab-3', filePath: 'C:\\c.txt', content: 'c', savedContent: 'c', encoding: 'utf-8', lineEnding: 'CRLF' },
                    ],
                    activeTabId: 'tab-1',
                }}
                onStateChange={onStateChange}
            />
        );

        const tabEls = screen.getAllByTitle(/\.txt$/);
        // Drag tab-3 onto tab-1
        fireEvent.dragStart(tabEls[2], { dataTransfer: { effectAllowed: 'move', setData: vi.fn() } });
        fireEvent.dragOver(tabEls[0], { dataTransfer: { dropEffect: 'move' }, preventDefault: vi.fn() });
        fireEvent.drop(tabEls[0], { dataTransfer: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() });
        fireEvent.dragEnd(tabEls[2]);

        // Verify reorder: tab-3 should now be first
        const lastCall = onStateChange.mock.calls[onStateChange.mock.calls.length - 1][0];
        expect(lastCall.tabs[0].id).toBe('tab-3');
        expect(lastCall.tabs[1].id).toBe('tab-1');
        expect(lastCall.tabs[2].id).toBe('tab-2');
    });

    it('sub-tabs have draggable attribute', () => {
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [{ id: 'tab-1', filePath: 'C:\\test.txt', content: '', savedContent: '', encoding: 'utf-8', lineEnding: 'CRLF' }],
                    activeTabId: 'tab-1',
                }}
            />
        );
        const tabEl = screen.getByTitle('C:\\test.txt');
        expect(tabEl.getAttribute('draggable')).toBe('true');
    });

    it('opens View menu on click', () => {
        render(<TextEditorPane sessionId="test-1" />);
        fireEvent.click(screen.getByText('View'));
        expect(screen.getByText(/Show Return Codes/)).toBeTruthy();
    });

    it('toggles return code overlay via View menu', () => {
        const { container } = render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [{
                        id: 'tab-1',
                        filePath: null,
                        content: 'line1\nline2\nline3',
                        savedContent: '',
                        encoding: 'utf-8',
                        lineEnding: 'CRLF',
                    }],
                    activeTabId: 'tab-1',
                }}
            />
        );
        // Initially overlay is visible (default ON)
        expect(container.querySelector('.text-editor-return-overlay')).toBeTruthy();
        const symbols = container.querySelectorAll('.text-editor-newline-symbol');
        expect(symbols.length).toBe(2); // 2 newlines between 3 lines

        // Toggle off via View menu
        fireEvent.click(screen.getByText('View'));
        fireEvent.click(screen.getByText(/Show Return Codes/));
        expect(container.querySelector('.text-editor-return-overlay')).toBeFalsy();

        // Toggle back on via View menu
        fireEvent.click(screen.getByText('View'));
        fireEvent.click(screen.getByText(/Show Return Codes/));
        expect(container.querySelector('.text-editor-return-overlay')).toBeTruthy();
    });

    it('triple-click selects entire line without newline', () => {
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [{
                        id: 'tab-1',
                        filePath: null,
                        content: 'first line\nsecond line\nthird line',
                        savedContent: '',
                        encoding: 'utf-8',
                        lineEnding: 'LF',
                    }],
                    activeTabId: 'tab-1',
                }}
            />
        );
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

        // Position cursor in the middle of the second line
        // 'first line\n' = 11 chars, then 's' at index 11
        Object.defineProperty(textarea, 'selectionStart', { value: 14, writable: true });
        Object.defineProperty(textarea, 'selectionEnd', { value: 14, writable: true });

        const setSelectionRange = vi.fn();
        textarea.setSelectionRange = setSelectionRange;

        fireEvent.click(textarea, { detail: 3 });

        // Should select 'second line' (index 11 to 22), not including '\n'
        expect(setSelectionRange).toHaveBeenCalledWith(11, 22);
    });

    it('triple-click selects last line (no trailing newline)', () => {
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [{
                        id: 'tab-1',
                        filePath: null,
                        content: 'aaa\nbbb',
                        savedContent: '',
                        encoding: 'utf-8',
                        lineEnding: 'LF',
                    }],
                    activeTabId: 'tab-1',
                }}
            />
        );
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

        // Position cursor in 'bbb' (index 5)
        Object.defineProperty(textarea, 'selectionStart', { value: 5, writable: true });
        Object.defineProperty(textarea, 'selectionEnd', { value: 5, writable: true });

        const setSelectionRange = vi.fn();
        textarea.setSelectionRange = setSelectionRange;

        fireEvent.click(textarea, { detail: 3 });

        // Should select 'bbb' (index 4 to 7)
        expect(setSelectionRange).toHaveBeenCalledWith(4, 7);
    });

    it('shows line numbers even when line wrap is enabled', () => {
        mockUseSettings.mockReturnValue({ settings: { lineWrapEnabled: true } });
        render(
            <TextEditorPane
                sessionId="test-1"
                initialState={{
                    tabs: [{
                        id: 'tab-1',
                        filePath: null,
                        content: 'line1\nline2\nline3',
                        savedContent: '',
                        encoding: 'utf-8',
                        lineEnding: 'CRLF',
                    }],
                    activeTabId: 'tab-1',
                }}
            />
        );
        expect(screen.getByText('1')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
    });
});
