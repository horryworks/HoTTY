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

const mockListLogFiles = vi.mocked(tauriService.listLogFiles);
const mockReadLogFile = vi.mocked(tauriService.readLogFile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LogViewerPane', () => {
  it('renders toolbar with folder input and Open button', () => {
    render(<LogViewerPane paneId="lv-1" active={true} />);
    expect(screen.getByPlaceholderText('Log folder path...')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('Open button is disabled when input is empty', () => {
    render(<LogViewerPane paneId="lv-1" active={true} />);
    const btn = screen.getByText('Open');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
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
      error: 'access denied: folder is not registered for logging',
    });

    render(<LogViewerPane paneId="lv-1" active={true} />);
    const input = screen.getByPlaceholderText('Log folder path...');
    fireEvent.change(input, { target: { value: '/forbidden' } });
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('access denied: folder is not registered for logging')).toBeTruthy();
    });
  });

  it('shows placeholder when no folder is set', () => {
    render(<LogViewerPane paneId="lv-1" active={true} />);
    expect(screen.getByText('Enter a folder path to browse log files')).toBeTruthy();
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
