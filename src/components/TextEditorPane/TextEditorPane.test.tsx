import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TextEditorPane } from './TextEditorPane';
import { tauriService } from '../../services/tauriService';

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
  it('renders toolbar with Untitled label for new file', () => {
    render(<TextEditorPane paneId="te-1" active={true} />);
    expect(screen.getByText('Untitled')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getByText('Save As')).toBeTruthy();
  });

  it('renders textarea for editing', () => {
    render(<TextEditorPane paneId="te-1" active={true} />);
    expect(screen.getByPlaceholderText('Open a file or start typing...')).toBeTruthy();
  });

  it('opens a file via dialog and displays content', async () => {
    mockOpenFile.mockResolvedValue('/docs/readme.txt');
    mockReadFile.mockResolvedValue({ content: 'Hello World', lineEnding: 'LF' });

    const onNameChange = vi.fn();
    render(<TextEditorPane paneId="te-1" active={true} onDisplayNameChange={onNameChange} />);

    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Hello World')).toBeTruthy();
    });
    expect(mockReadFile).toHaveBeenCalledWith('/docs/readme.txt', 'utf-8');
    expect(onNameChange).toHaveBeenCalledWith('readme.txt');
  });

  it('does nothing when open dialog is cancelled', async () => {
    mockOpenFile.mockResolvedValue(null);

    render(<TextEditorPane paneId="te-1" active={true} />);
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });

  it('saves existing file', async () => {
    mockOpenFile.mockResolvedValue('/docs/test.txt');
    mockReadFile.mockResolvedValue({ content: 'original', lineEnding: 'LF' });
    mockWriteFile.mockResolvedValue(true);

    render(<TextEditorPane paneId="te-1" active={true} />);
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('original')).toBeTruthy();
    });

    const textarea = screen.getByDisplayValue('original') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'modified' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockWriteFile).toHaveBeenCalledWith('/docs/test.txt', 'modified', 'utf-8');
    });
  });

  it('shows dirty indicator when content is modified', async () => {
    mockOpenFile.mockResolvedValue('/docs/test.txt');
    mockReadFile.mockResolvedValue({ content: 'original', lineEnding: 'CRLF' });

    const { container } = render(<TextEditorPane paneId="te-1" active={true} />);
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('original')).toBeTruthy();
    });

    // No dirty indicator initially
    expect(container.querySelector('.text-editor-dirty')).toBeNull();

    const textarea = screen.getByDisplayValue('original') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'changed' } });

    // Dirty indicator should appear
    expect(container.querySelector('.text-editor-dirty')).toBeTruthy();
  });

  it('shows line ending from loaded file', async () => {
    mockOpenFile.mockResolvedValue('/docs/test.txt');
    mockReadFile.mockResolvedValue({ content: 'test', lineEnding: 'CRLF' });

    render(<TextEditorPane paneId="te-1" active={true} />);
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('CRLF')).toBeTruthy();
    });
  });

  it('Ctrl+S triggers save', async () => {
    mockOpenFile.mockResolvedValue('/docs/test.txt');
    mockReadFile.mockResolvedValue({ content: 'data', lineEnding: 'LF' });
    mockWriteFile.mockResolvedValue(true);

    const { container } = render(<TextEditorPane paneId="te-1" active={true} />);
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('data')).toBeTruthy();
    });

    fireEvent.keyDown(container.firstChild as HTMLElement, { key: 's', ctrlKey: true });

    await waitFor(() => {
      expect(mockWriteFile).toHaveBeenCalledWith('/docs/test.txt', 'data', 'utf-8');
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
});
