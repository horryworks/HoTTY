import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LogViewerPane } from './LogViewerPane';
import { tauriService } from '../../services/tauriService';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    listLogFiles: vi.fn(),
    readLogFile: vi.fn(),
    confirmLogDir: vi.fn().mockResolvedValue(true),
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

// jsdom does not implement scrollIntoView; the pane calls it to reveal the
// focused match.
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

/** Render the pane, open /logs, and select a single log file with `content`. */
async function openLog(content: string, active = true) {
  mockListLogFiles.mockResolvedValue({
    files: [{ name: 'test.log', path: '/logs/test.log', mtime: 1700000000000, size: 512 }],
  });
  mockReadLogFile.mockResolvedValue({ content });

  const result = render(<LogViewerPane paneId="lv-1" active={active} />);
  fireEvent.change(screen.getByPlaceholderText('Log folder path...'), { target: { value: '/logs' } });
  fireEvent.click(screen.getByText('Open'));

  await waitFor(() => {
    expect(screen.getByText('test.log')).toBeTruthy();
  });
  fireEvent.click(screen.getByText('test.log'));
  await waitFor(() => {
    expect(document.querySelector('.log-viewer-search-bar')).toBeTruthy();
    expect(document.querySelector('.log-viewer-pre')?.textContent).toBe(content);
  });
  return result;
}

/** Type into the find bar and wait for the debounced search to land. */
async function search(query: string) {
  fireEvent.change(screen.getByLabelText('Search in log'), { target: { value: query } });
  await waitFor(() => {
    expect(screen.getByLabelText('Search in log')).toHaveProperty('value', query);
    expect(document.querySelector('.log-viewer-search-count')!.textContent).not.toBe('');
  });
}

const marks = () => Array.from(document.querySelectorAll('mark')).map((m) => m.textContent);
const countText = () => document.querySelector('.log-viewer-search-count')!.textContent;

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

  it('lists and opens an AI chat transcript (.md)', async () => {
    const chatLog = '20260727091402-AICHAT-router-a.md';
    mockListLogFiles.mockResolvedValue({
      files: [
        { name: chatLog, path: `/logs/${chatLog}`, mtime: 1700000000000, size: 2048 },
        { name: 'session.txt', path: '/logs/session.txt', mtime: 1600000000000, size: 512 },
      ],
    });
    mockReadLogFile.mockResolvedValue({
      content: '# AI Chat — router-a\n\n## [2026-07-27 09:14:02.100] User\n\n```text\nshow version\n```\n',
    });

    render(<LogViewerPane paneId="lv-1" active={true} />);
    fireEvent.change(screen.getByPlaceholderText('Log folder path...'), { target: { value: '/logs' } });
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText(chatLog)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(chatLog));

    await waitFor(() => {
      const pre = document.querySelector('.log-viewer-pre');
      expect(pre).toBeTruthy();
      // Rendered as raw markdown source — no HTML rendering, no XSS surface.
      expect(pre!.textContent).toContain('# AI Chat — router-a');
      expect(pre!.textContent).toContain('```text');
    });
    expect(mockReadLogFile).toHaveBeenCalledWith(`/logs/${chatLog}`);
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

describe('LogViewerPane in-log search', () => {
  const LOG = [
    '2026-07-27 10:01:03 ssh: connect to vm-01',
    '2026-07-27 10:01:09 read TIMEOUT after 30s',
    '2026-07-27 10:01:10 retrying',
    '2026-07-27 10:02:44 socket timeout',
  ].join('\n');

  it('shows the find bar only once a file is open', async () => {
    mockListLogFiles.mockResolvedValue({ files: [] });
    render(<LogViewerPane paneId="lv-1" active={true} />);
    fireEvent.change(screen.getByPlaceholderText('Log folder path...'), { target: { value: '/logs' } });
    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('Select a file to view its content.')).toBeTruthy();
    });
    expect(document.querySelector('.log-viewer-search-bar')).toBeNull();
  });

  it('highlights every match and reports the count', async () => {
    await openLog(LOG);
    await search('timeout');

    expect(marks()).toEqual(['TIMEOUT', 'timeout']);
    expect(countText()).toBe('1 / 2');
  });

  it('never alters the log text while highlighting', async () => {
    await openLog(LOG);
    await search('timeout');

    expect(document.querySelector('.log-viewer-pre')!.textContent).toBe(LOG);
  });

  it('marks the focused match and steps through with the arrow buttons', async () => {
    await openLog(LOG);
    await search('timeout');

    const current = () => document.querySelector('mark.current')!.textContent;
    expect(current()).toBe('TIMEOUT');

    fireEvent.click(screen.getByLabelText('Next match (Enter)'));
    expect(current()).toBe('timeout');
    expect(countText()).toBe('2 / 2');

    // Wraps around.
    fireEvent.click(screen.getByLabelText('Next match (Enter)'));
    expect(current()).toBe('TIMEOUT');
    expect(countText()).toBe('1 / 2');

    fireEvent.click(screen.getByLabelText('Previous match (Shift+Enter)'));
    expect(countText()).toBe('2 / 2');
  });

  it('Enter and Shift+Enter step through matches', async () => {
    await openLog(LOG);
    await search('timeout');

    const input = screen.getByLabelText('Search in log');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(countText()).toBe('2 / 2');

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(countText()).toBe('1 / 2');
  });

  it('honours the match-case toggle', async () => {
    await openLog(LOG);
    await search('timeout');
    expect(marks()).toEqual(['TIMEOUT', 'timeout']);

    fireEvent.click(screen.getByLabelText('Match case'));
    await waitFor(() => {
      expect(marks()).toEqual(['timeout']);
    });
    expect(countText()).toBe('1 / 1');
  });

  it('honours the regex toggle', async () => {
    await openLog(LOG);
    await search('connect|retrying');
    expect(marks()).toEqual([]);
    expect(countText()).toBe('No matches');

    fireEvent.click(screen.getByLabelText('Use regular expression'));
    await waitFor(() => {
      expect(marks()).toEqual(['connect', 'retrying']);
    });
  });

  it('flags an invalid regex instead of crashing', async () => {
    await openLog(LOG);
    fireEvent.click(screen.getByLabelText('Use regular expression'));
    await search('[unclosed');

    expect(countText()).toBe('Invalid regular expression');
    expect(screen.getByLabelText('Search in log').classList.contains('invalid')).toBe(true);
    // Content still renders, just unhighlighted.
    expect(document.querySelector('.log-viewer-pre')!.textContent).toBe(LOG);
  });

  it('shows only matching lines when "Matching lines only" is checked', async () => {
    await openLog(LOG);
    await search('timeout');

    fireEvent.click(screen.getByLabelText('Matching lines only'));
    await waitFor(() => {
      expect(document.querySelector('.log-viewer-filtered')).toBeTruthy();
    });

    const rows = Array.from(document.querySelectorAll('.log-viewer-match-line'))
      .map((r) => r.textContent);
    expect(rows).toEqual([
      '2026-07-27 10:01:09 read TIMEOUT after 30s',
      '2026-07-27 10:02:44 socket timeout',
    ]);
    expect(document.querySelector('.log-viewer-pre')).toBeNull();
    expect(document.querySelector('.log-viewer-match-line.current')!.textContent)
      .toBe('2026-07-27 10:01:09 read TIMEOUT after 30s');
  });

  it('reports no matches in filtered mode', async () => {
    await openLog(LOG);
    fireEvent.click(screen.getByLabelText('Matching lines only'));
    await search('nosuchthing');

    // Both the counter and the empty content area report it.
    await waitFor(() => {
      expect(countText()).toBe('No matches');
    });
    expect(document.querySelector('.log-viewer-file-content .log-viewer-placeholder')!.textContent)
      .toBe('No matches');
    expect(document.querySelectorAll('.log-viewer-match-line')).toHaveLength(0);
  });

  it('Ctrl+F focuses and selects the find box while the pane is active', async () => {
    await openLog(LOG);
    await search('timeout');
    const input = screen.getByLabelText('Search in log') as HTMLInputElement;
    input.blur();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('timeout'.length);
  });

  it('leaves Ctrl+F alone when the pane is not active', async () => {
    await openLog(LOG, false);
    const input = screen.getByLabelText('Search in log');

    const ev = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);

    expect(document.activeElement).not.toBe(input);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('Escape clears the query', async () => {
    await openLog(LOG);
    await search('timeout');

    const input = screen.getByLabelText('Search in log');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input).toHaveProperty('value', '');
    await waitFor(() => {
      expect(marks()).toEqual([]);
    });
    expect(document.querySelector('.log-viewer-pre')!.textContent).toBe(LOG);
  });

  it('the clear button empties the query', async () => {
    await openLog(LOG);
    await search('timeout');

    fireEvent.click(screen.getByLabelText('Clear search'));

    expect(screen.getByLabelText('Search in log')).toHaveProperty('value', '');
    await waitFor(() => {
      expect(marks()).toEqual([]);
    });
  });

  it('keeps the query and re-searches when another file is opened', async () => {
    mockListLogFiles.mockResolvedValue({
      files: [
        { name: 'a.log', path: '/logs/a.log', mtime: 1700000000000, size: 512 },
        { name: 'b.log', path: '/logs/b.log', mtime: 1600000000000, size: 512 },
      ],
    });
    mockReadLogFile.mockResolvedValue({ content: 'has timeout here' });

    render(<LogViewerPane paneId="lv-1" active={true} />);
    fireEvent.change(screen.getByPlaceholderText('Log folder path...'), { target: { value: '/logs' } });
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => {
      expect(screen.getByText('a.log')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('a.log'));
    await waitFor(() => {
      expect(document.querySelector('.log-viewer-search-bar')).toBeTruthy();
    });
    await search('timeout');
    expect(countText()).toBe('1 / 1');

    mockReadLogFile.mockResolvedValue({ content: 'timeout\ntimeout' });
    fireEvent.click(screen.getByText('b.log'));

    await waitFor(() => {
      expect(countText()).toBe('1 / 2');
    });
    expect(screen.getByLabelText('Search in log')).toHaveProperty('value', 'timeout');
  });
});
