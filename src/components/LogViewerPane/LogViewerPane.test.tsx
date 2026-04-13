import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LogViewerPane } from './LogViewerPane';
import { tauriService } from '../../services/tauriService';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    listLogFiles: vi.fn(),
    readLogFile: vi.fn(),
  },
}));

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: vi.fn((selector) => selector({ loggingPath: '' })),
}));

vi.mock('../../hooks/useResize', () => ({
  useResize: () => ({ startResize: vi.fn(), isResizing: false }),
}));

const mockListLogFiles = vi.mocked(tauriService.listLogFiles);
const mockReadLogFile = vi.mocked(tauriService.readLogFile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LogViewerPane', () => {
  it('renders folder input toolbar when no folder is set', () => {
    render(<LogViewerPane paneId="lv-1" active={true} />);
    expect(screen.getByPlaceholderText('Log folder path...')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('Open button is disabled when input is empty', () => {
    render(<LogViewerPane paneId="lv-1" active={true} />);
    const btn = screen.getByText('Open');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders filter input and Refresh button in file list panel', () => {
    render(<LogViewerPane paneId="lv-1" active={true} />);
    expect(screen.getByPlaceholderText('Filter files...')).toBeTruthy();
    expect(screen.getByText('Refresh')).toBeTruthy();
  });

  it('renders divider with collapse toggle', () => {
    render(<LogViewerPane paneId="lv-1" active={true} />);
    const divider = document.querySelector('.log-viewer-divider');
    expect(divider).toBeTruthy();
    const toggle = document.querySelector('.log-viewer-divider-toggle');
    expect(toggle).toBeTruthy();
  });

  it('collapses file list panel when toggle is clicked', () => {
    render(<LogViewerPane paneId="lv-1" active={true} />);
    expect(document.querySelector('.log-viewer-file-list')).toBeTruthy();

    const toggle = document.querySelector('.log-viewer-divider-toggle') as HTMLButtonElement;
    fireEvent.click(toggle);

    expect(document.querySelector('.log-viewer-file-list')).toBeNull();
    expect(toggle.classList.contains('collapsed')).toBe(true);
  });

  it('expands file list panel when toggle is clicked again', () => {
    render(<LogViewerPane paneId="lv-1" active={true} />);
    const toggle = document.querySelector('.log-viewer-divider-toggle') as HTMLButtonElement;

    fireEvent.click(toggle); // collapse
    expect(document.querySelector('.log-viewer-file-list')).toBeNull();

    fireEvent.click(toggle); // expand
    expect(document.querySelector('.log-viewer-file-list')).toBeTruthy();
  });

  it('shows path header after folder is opened', async () => {
    mockListLogFiles.mockResolvedValue({ files: [] });

    render(<LogViewerPane paneId="lv-1" active={true} />);
    const input = screen.getByPlaceholderText('Log folder path...');
    fireEvent.change(input, { target: { value: '/logs' } });
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('Log Viewer')).toBeTruthy();
      expect(screen.getByText('/logs')).toBeTruthy();
    });
  });

  it('loads file list when folder is opened', async () => {
    mockListLogFiles.mockResolvedValue({
      files: [
        { name: 'test.log', path: '/logs/test.log', mtime: 1700000000000, size: 1024 },
      ],
    });

    render(<LogViewerPane paneId="lv-1" active={true} />);
    const input = screen.getByPlaceholderText('Log folder path...');
    fireEvent.change(input, { target: { value: '/logs' } });
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('test.log')).toBeTruthy();
    });
    expect(mockListLogFiles).toHaveBeenCalledWith('/logs');
  });

  it('filters file list by name', async () => {
    mockListLogFiles.mockResolvedValue({
      files: [
        { name: 'app.log', path: '/logs/app.log', mtime: 1700000000000, size: 512 },
        { name: 'error.log', path: '/logs/error.log', mtime: 1700000000000, size: 256 },
      ],
    });

    render(<LogViewerPane paneId="lv-1" active={true} />);
    const folderInput = screen.getByPlaceholderText('Log folder path...');
    fireEvent.change(folderInput, { target: { value: '/logs' } });
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('app.log')).toBeTruthy();
      expect(screen.getByText('error.log')).toBeTruthy();
    });

    const filterInput = screen.getByPlaceholderText('Filter files...');
    fireEvent.change(filterInput, { target: { value: 'error' } });

    expect(screen.queryByText('app.log')).toBeNull();
    expect(screen.getByText('error.log')).toBeTruthy();
  });

  it('loads file content when a file is selected', async () => {
    mockListLogFiles.mockResolvedValue({
      files: [
        { name: 'test.log', path: '/logs/test.log', mtime: 1700000000000, size: 512 },
      ],
    });
    mockReadLogFile.mockResolvedValue({
      content: 'line1\nline2\nline3',
    });

    render(<LogViewerPane paneId="lv-1" active={true} />);
    const input = screen.getByPlaceholderText('Log folder path...');
    fireEvent.change(input, { target: { value: '/logs' } });
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('test.log')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('test.log'));

    await waitFor(() => {
      const pre = document.querySelector('.log-viewer-pre');
      expect(pre).toBeTruthy();
      expect(pre!.textContent).toContain('line1');
      expect(pre!.textContent).toContain('line3');
    });
    expect(mockReadLogFile).toHaveBeenCalledWith('/logs/test.log');
  });

  it('shows error when listLogFiles returns error', async () => {
    mockListLogFiles.mockResolvedValue({
      error: 'Log folder is not registered',
    });

    render(<LogViewerPane paneId="lv-1" active={true} />);
    const input = screen.getByPlaceholderText('Log folder path...');
    fireEvent.change(input, { target: { value: '/forbidden' } });
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('Log folder is not registered')).toBeTruthy();
    });
  });

  it('shows placeholder when no folder is set', () => {
    render(<LogViewerPane paneId="lv-1" active={true} />);
    expect(screen.getByText('Enter a folder path to browse log files')).toBeTruthy();
  });

  it('shows select file placeholder after folder is opened', async () => {
    mockListLogFiles.mockResolvedValue({ files: [] });

    render(<LogViewerPane paneId="lv-1" active={true} />);
    const input = screen.getByPlaceholderText('Log folder path...');
    fireEvent.change(input, { target: { value: '/logs' } });
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('Select a file to view its content.')).toBeTruthy();
    });
  });

  it('Enter key in input triggers folder open', async () => {
    mockListLogFiles.mockResolvedValue({ files: [] });

    render(<LogViewerPane paneId="lv-1" active={true} />);
    const input = screen.getByPlaceholderText('Log folder path...');
    fireEvent.change(input, { target: { value: '/logs' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockListLogFiles).toHaveBeenCalledWith('/logs');
    });
  });
});
