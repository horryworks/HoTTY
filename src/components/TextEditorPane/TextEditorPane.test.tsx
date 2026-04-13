import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TextEditorPane } from './TextEditorPane';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    textEditorOpenFile: vi.fn(),
    textEditorSaveFile: vi.fn(),
    textEditorReadFile: vi.fn(),
    textEditorWriteFile: vi.fn(),
    textEditorApproveDroppedFile: vi.fn(),
  },
}));

const mockOpenFile = vi.mocked(tauriService.textEditorOpenFile);
const mockReadFile = vi.mocked(tauriService.textEditorReadFile);
const mockWriteFile = vi.mocked(tauriService.textEditorWriteFile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TextEditorPane', () => {
  it('renders with sub-tab bar showing Untitled tab', () => {
    render(<TextEditorPane paneId="te-1" active={true} />);
    expect(screen.getByText('Untitled')).toBeTruthy();
  });

  it('renders File/Edit/View menus', () => {
    render(<TextEditorPane paneId="te-1" active={true} />);
    expect(screen.getByText('File')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('View')).toBeTruthy();
  });

  it('opens a file via File > Open and shows it in a sub-tab', async () => {
    mockOpenFile.mockResolvedValue('/docs/readme.txt');
    mockReadFile.mockResolvedValue({ content: 'Hello World', lineEnding: 'LF' });

    const onNameChange = vi.fn();
    render(<TextEditorPane paneId="te-1" active={true} onDisplayNameChange={onNameChange} />);

    // Open File menu
    fireEvent.click(screen.getByText('File'));
    // Click Open
    fireEvent.click(screen.getByText('Open...'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Hello World')).toBeTruthy();
    });
    expect(mockReadFile).toHaveBeenCalledWith('/docs/readme.txt', 'utf-8');
    expect(onNameChange).toHaveBeenCalledWith('readme.txt');
  });

  it('does nothing when open dialog is cancelled', async () => {
    mockOpenFile.mockResolvedValue(null);

    render(<TextEditorPane paneId="te-1" active={true} />);
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('Open...'));

    await waitFor(() => {
      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });

  it('saves file via File > Save', async () => {
    mockOpenFile.mockResolvedValue('/docs/test.txt');
    mockReadFile.mockResolvedValue({ content: 'original', lineEnding: 'LF' });
    mockWriteFile.mockResolvedValue(true);

    render(<TextEditorPane paneId="te-1" active={true} />);
    // Open a file first
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('Open...'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('original')).toBeTruthy();
    });

    // Modify content
    const textarea = screen.getByDisplayValue('original') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'modified' } });

    // Save
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockWriteFile).toHaveBeenCalledWith('/docs/test.txt', 'modified', 'utf-8');
    });
  });

  it('shows dirty indicator when content is modified', async () => {
    mockOpenFile.mockResolvedValue('/docs/test.txt');
    mockReadFile.mockResolvedValue({ content: 'original', lineEnding: 'CRLF' });

    render(<TextEditorPane paneId="te-1" active={true} />);
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('Open...'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('original')).toBeTruthy();
    });

    // No dirty indicator initially
    expect(screen.queryByText('Modified')).toBeNull();

    const textarea = screen.getByDisplayValue('original') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'changed' } });

    // Modified indicator should appear in status bar
    expect(screen.getByText('Modified')).toBeTruthy();
  });

  it('shows line ending from loaded file', async () => {
    mockOpenFile.mockResolvedValue('/docs/test.txt');
    mockReadFile.mockResolvedValue({ content: 'test', lineEnding: 'CRLF' });

    render(<TextEditorPane paneId="te-1" active={true} />);
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('Open...'));

    await waitFor(() => {
      expect(screen.getByText('CRLF')).toBeTruthy();
    });
  });

  it('loads initial file when initialFilePath is provided', async () => {
    mockReadFile.mockResolvedValue({ content: 'initial content', lineEnding: 'LF' });

    render(<TextEditorPane paneId="te-1" active={true} initialFilePath="/docs/init.txt" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('initial content')).toBeTruthy();
    });
    expect(mockReadFile).toHaveBeenCalledWith('/docs/init.txt', 'utf-8');
  });

  it('creates new tab via + button', () => {
    render(<TextEditorPane paneId="te-1" active={true} />);

    // Click the + button to add a new tab
    fireEvent.click(screen.getByTitle('New Tab'));

    // Should now have two Untitled tabs
    const untitledTabs = screen.getAllByText('Untitled');
    expect(untitledTabs.length).toBe(2);
  });

  it('switches between sub-tabs', async () => {
    mockOpenFile.mockResolvedValue('/docs/file1.txt');
    mockReadFile.mockResolvedValue({ content: 'file1 content', lineEnding: 'LF' });

    render(<TextEditorPane paneId="te-1" active={true} />);

    // Open a file in the first tab
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('Open...'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('file1 content')).toBeTruthy();
    });

    // Add a new tab
    fireEvent.click(screen.getByTitle('New Tab'));

    // The new tab should be active (empty textarea)
    const textarea = document.querySelector('.text-editor-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');

    // Click on the first tab to switch back
    fireEvent.click(screen.getByText('file1.txt'));

    await waitFor(() => {
      const ta = document.querySelector('.text-editor-textarea') as HTMLTextAreaElement;
      expect(ta.value).toBe('file1 content');
    });
  });

  it('closes tab via close button', async () => {
    render(<TextEditorPane paneId="te-1" active={true} />);

    // Add a second tab
    fireEvent.click(screen.getByTitle('New Tab'));
    expect(screen.getAllByText('Untitled').length).toBe(2);

    // Close the active tab using the close button (x icon)
    const closeBtns = document.querySelectorAll('.text-editor-subtab-close');
    fireEvent.click(closeBtns[closeBtns.length - 1]);

    // Should be back to one tab
    expect(screen.getAllByText('Untitled').length).toBe(1);
  });

  it('shows cursor position in status bar', () => {
    render(<TextEditorPane paneId="te-1" active={true} />);
    expect(screen.getByText('Ln 1, Col 1')).toBeTruthy();
  });

  it('applies wrap styles when lineWrapEnabled is true', () => {
    useSettingsStore.getState().update('lineWrapEnabled', true);
    render(<TextEditorPane paneId="te-1" active={true} />);
    const textarea = document.querySelector('.text-editor-textarea') as HTMLTextAreaElement;
    expect(textarea.getAttribute('wrap')).toBe('soft');
    expect(textarea.style.whiteSpace).toBe('pre-wrap');
    expect(textarea.style.wordWrap).toBe('break-word');
  });

  it('applies no-wrap styles when lineWrapEnabled is false', () => {
    useSettingsStore.getState().update('lineWrapEnabled', false);
    render(<TextEditorPane paneId="te-1" active={true} />);
    const textarea = document.querySelector('.text-editor-textarea') as HTMLTextAreaElement;
    expect(textarea.getAttribute('wrap')).toBe('off');
    expect(textarea.style.whiteSpace).toBe('pre');
  });

  it('shows Line Wrap item in View menu with checkmark when enabled', () => {
    useSettingsStore.getState().update('lineWrapEnabled', true);
    render(<TextEditorPane paneId="te-1" active={true} />);
    fireEvent.click(screen.getByText('View'));
    expect(screen.getByText(/Line Wrap/)).toBeTruthy();
    expect(screen.getByText(/\u2713.*Line Wrap/)).toBeTruthy();
  });

  it('shows line numbers when line wrap is enabled', () => {
    useSettingsStore.getState().update('lineWrapEnabled', true);
    render(<TextEditorPane paneId="te-1" active={true} />);
    const lineNumbers = document.querySelectorAll('.text-editor-line-number');
    expect(lineNumbers.length).toBeGreaterThan(0);
  });
});
