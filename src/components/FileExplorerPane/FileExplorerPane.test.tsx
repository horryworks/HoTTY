import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileExplorerPane } from './FileExplorerPane';
import { tauriService } from '../../services/tauriService';

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
  });

  it('expands directory on click', async () => {
    mockGetDrives.mockResolvedValue({ drives: ['C:\\'], homedir: 'C:\\Users\\test' });
    mockListDir
      .mockResolvedValueOnce({
        entries: [
          { name: 'Users', isDirectory: true, size: 0, mtime: 1700000000000, isHidden: false },
        ],
      })
      .mockResolvedValueOnce({
        entries: [
          { name: 'test', isDirectory: true, size: 0, mtime: 1700000000000, isHidden: false },
        ],
      })
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

    // Click on Documents to expand it
    fireEvent.click(screen.getByText('Documents').closest('.file-explorer-row')!);

    await waitFor(() => {
      expect(screen.getByText('file.txt')).toBeTruthy();
    });
  });

  it('hides hidden files by default', async () => {
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
  });

  it('shows hidden files when toggle is clicked', async () => {
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

    // Click the show hidden button (eye icon)
    const hiddenBtn = screen.getByTitle('Show hidden files');
    fireEvent.click(hiddenBtn);

    await waitFor(() => {
      expect(screen.getByText('.gitignore')).toBeTruthy();
    });
  });

  it('calls onOpenFileInEditor when double-clicking a file', async () => {
    mockGetDrives.mockResolvedValue({ drives: ['C:\\'], homedir: 'C:\\Users\\test' });
    // The component will expand C:\, C:\Users, and C:\Users\test sequentially.
    // The last listing is for C:\Users\test which contains notes.txt.
    mockListDir
      .mockResolvedValueOnce({
        entries: [
          { name: 'Users', isDirectory: true, size: 0, mtime: 1700000000000, isHidden: false },
        ],
      })
      .mockResolvedValueOnce({
        entries: [
          { name: 'test', isDirectory: true, size: 0, mtime: 1700000000000, isHidden: false },
        ],
      })
      .mockResolvedValueOnce({
        entries: [
          { name: 'notes.txt', isDirectory: false, size: 100, mtime: 1700000000000, isHidden: false },
        ],
      });

    const onOpen = vi.fn();
    render(<FileExplorerPane paneId="fe-1" active={true} onOpenFileInEditor={onOpen} />);

    await waitFor(() => {
      expect(screen.getByText('notes.txt')).toBeTruthy();
    });

    fireEvent.doubleClick(screen.getByText('notes.txt').closest('.file-explorer-row')!);
    expect(onOpen).toHaveBeenCalledWith('C:\\Users\\test\\notes.txt');
  });

  it('shows drive roots in tree', async () => {
    mockGetDrives.mockResolvedValue({ drives: ['C:\\', 'D:\\'], homedir: '' });
    mockListDir.mockResolvedValue({ entries: [] });

    render(<FileExplorerPane paneId="fe-1" active={true} />);

    await waitFor(() => {
      expect(screen.getByText('C:\\')).toBeTruthy();
      expect(screen.getByText('D:\\')).toBeTruthy();
    });
  });
});
