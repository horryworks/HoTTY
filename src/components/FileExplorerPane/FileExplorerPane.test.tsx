import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileExplorerPane } from './FileExplorerPane';
import { tauriService } from '../../services/tauriService';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    fileExplorerGetDrives: vi.fn(),
    fileExplorerListDirectory: vi.fn(),
    textEditorApproveDroppedFile: vi.fn(),
  },
}));

const mockGetDrives = vi.mocked(tauriService.fileExplorerGetDrives);
const mockListDir = vi.mocked(tauriService.fileExplorerListDirectory);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FileExplorerPane', () => {
  it('fetches drives and lists home directory on mount', async () => {
    mockGetDrives.mockResolvedValue({ drives: ['C:\\', 'D:\\'], homedir: 'C:\\Users\\test' });
    mockListDir.mockResolvedValue({
      entries: [
        { name: 'Documents', isDirectory: true, size: 0, mtime: 1700000000000, isHidden: false },
        { name: 'readme.txt', isDirectory: false, size: 256, mtime: 1700000000000, isHidden: false },
      ],
    });

    render(<FileExplorerPane paneId="fe-1" active={true} />);

    await waitFor(() => {
      expect(screen.getByText('Documents')).toBeTruthy();
      expect(screen.getByText('readme.txt')).toBeTruthy();
    });
    expect(mockGetDrives).toHaveBeenCalledTimes(1);
    expect(mockListDir).toHaveBeenCalledWith('C:\\Users\\test');
  });

  it('navigates into directory on double-click', async () => {
    mockGetDrives.mockResolvedValue({ drives: ['C:\\'], homedir: 'C:\\Users\\test' });
    mockListDir
      .mockResolvedValueOnce({
        entries: [
          { name: 'Documents', isDirectory: true, size: 0, mtime: 1700000000000, isHidden: false },
        ],
      })
      .mockResolvedValueOnce({
        entries: [
          { name: 'file.txt', isDirectory: false, size: 100, mtime: 1700000000000, isHidden: false },
        ],
      });

    render(<FileExplorerPane paneId="fe-1" active={true} />);

    await waitFor(() => {
      expect(screen.getByText('Documents')).toBeTruthy();
    });

    fireEvent.doubleClick(screen.getByText('Documents').closest('tr')!);

    await waitFor(() => {
      expect(screen.getByText('file.txt')).toBeTruthy();
    });
    expect(mockListDir).toHaveBeenCalledWith('C:\\Users\\test\\Documents');
  });

  it('toggles hidden files', async () => {
    mockGetDrives.mockResolvedValue({ drives: ['C:\\'], homedir: 'C:\\Users\\test' });
    mockListDir.mockResolvedValue({
      entries: [
        { name: '.gitignore', isDirectory: false, size: 50, mtime: 1700000000000, isHidden: true },
        { name: 'readme.txt', isDirectory: false, size: 100, mtime: 1700000000000, isHidden: false },
      ],
    });

    render(<FileExplorerPane paneId="fe-1" active={true} />);

    await waitFor(() => {
      expect(screen.getByText('readme.txt')).toBeTruthy();
    });

    // Hidden file should not be visible by default
    expect(screen.queryByText('.gitignore')).toBeNull();

    // Toggle hidden files
    fireEvent.click(screen.getByText('Hidden'));

    expect(screen.getByText('.gitignore')).toBeTruthy();
  });

  it('sorts by column headers', async () => {
    mockGetDrives.mockResolvedValue({ drives: ['C:\\'], homedir: '/home' });
    mockListDir.mockResolvedValue({
      entries: [
        { name: 'bravo.txt', isDirectory: false, size: 200, mtime: 1700000000000, isHidden: false },
        { name: 'alpha.txt', isDirectory: false, size: 100, mtime: 1700000001000, isHidden: false },
      ],
    });

    render(<FileExplorerPane paneId="fe-1" active={true} />);

    await waitFor(() => {
      expect(screen.getByText('alpha.txt')).toBeTruthy();
    });

    // Default sort is name ascending, so alpha comes first
    const rows = document.querySelectorAll('.file-explorer-row');
    expect(rows[0].textContent).toContain('alpha.txt');
    expect(rows[1].textContent).toContain('bravo.txt');

    // Click Size header to sort by size
    fireEvent.click(screen.getByText(/^Size/));

    const rowsAfter = document.querySelectorAll('.file-explorer-row');
    expect(rowsAfter[0].textContent).toContain('alpha.txt'); // size 100
    expect(rowsAfter[1].textContent).toContain('bravo.txt'); // size 200
  });

  it('shows error when directory listing fails', async () => {
    mockGetDrives.mockResolvedValue({ drives: ['C:\\'], homedir: '/nonexistent' });
    mockListDir.mockResolvedValue({
      error: 'permission denied',
    });

    render(<FileExplorerPane paneId="fe-1" active={true} />);

    await waitFor(() => {
      expect(screen.getByText('permission denied')).toBeTruthy();
    });
  });

  it('calls onOpenFileInEditor when double-clicking a file', async () => {
    mockGetDrives.mockResolvedValue({ drives: ['C:\\'], homedir: 'C:\\Users\\test' });
    mockListDir.mockResolvedValue({
      entries: [
        { name: 'notes.txt', isDirectory: false, size: 100, mtime: 1700000000000, isHidden: false },
      ],
    });

    const onOpen = vi.fn();
    render(<FileExplorerPane paneId="fe-1" active={true} onOpenFileInEditor={onOpen} />);

    await waitFor(() => {
      expect(screen.getByText('notes.txt')).toBeTruthy();
    });

    fireEvent.doubleClick(screen.getByText('notes.txt').closest('tr')!);
    expect(onOpen).toHaveBeenCalledWith('C:\\Users\\test\\notes.txt');
  });
});
