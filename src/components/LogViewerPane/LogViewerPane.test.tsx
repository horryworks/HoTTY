import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { buildRegex, LogViewerPane } from './LogViewerPane';
import * as electronService from '../../services/electronService';

// ── Mock @tanstack/react-virtual ──────────────────────────────────────────────
// jsdom has no layout engine, so the virtualizer returns 0 items without this.
vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: ({ count }: { count: number }) => ({
        getVirtualItems: () =>
            Array.from({ length: count }, (_, i) => ({ index: i, start: i * 20, size: 20, key: i })),
        getTotalSize: () => count * 20,
        scrollToIndex: vi.fn(),
        measureElement: () => {},
    }),
}));

// ── Mock electronService ──────────────────────────────────────────────────────
vi.mock('../../services/electronService', () => ({
    listLogFiles: vi.fn(),
    readLogFile: vi.fn(),
}));

const mockListLogFiles = vi.mocked(electronService.listLogFiles);
const mockReadLogFile  = vi.mocked(electronService.readLogFile);

// ── buildRegex ────────────────────────────────────────────────────────────────
describe('buildRegex', () => {
    it('returns null for empty query', () => {
        expect(buildRegex('', false)).toBeNull();
        expect(buildRegex('', true)).toBeNull();
    });

    it('plain text: escapes regex metacharacters', () => {
        const re = buildRegex('1.0', false)!;
        expect(re).not.toBeNull();
        expect(re.test('1.0')).toBe(true);
        expect(re.test('1X0')).toBe(false); // dot is literal, not wildcard
    });

    it('plain text: matches case-insensitively', () => {
        const re = buildRegex('hello', false)!;
        re.lastIndex = 0;
        expect(re.test('Hello World')).toBe(true);
        re.lastIndex = 0;
        expect(re.test('HELLO')).toBe(true);
    });

    it('regex mode: uses pattern as-is', () => {
        const re = buildRegex('\\d+', true)!;
        expect(re.test('abc123')).toBe(true);
        expect(re.test('abc')).toBe(false);
    });

    it('regex mode: returns null for invalid pattern', () => {
        expect(buildRegex('[invalid', true)).toBeNull();
    });

    it('regex mode: supports anchors', () => {
        const re = buildRegex('^ERROR', true)!;
        expect(re.test('ERROR: something')).toBe(true);
        expect(re.test('prefix ERROR')).toBe(false);
    });
});

// ── LogViewerPane component ───────────────────────────────────────────────────
describe('LogViewerPane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── Initial / error states ──

    it('shows "not configured" when loggingPath is empty', async () => {
        mockListLogFiles.mockResolvedValue({ error: 'No log folder configured', files: [] });
        render(<LogViewerPane loggingPath="" />);
        expect(screen.getByText('(not configured)')).toBeInTheDocument();
    });

    it('shows error when listLogFiles fails', async () => {
        mockListLogFiles.mockResolvedValue({ error: 'Log folder does not exist', files: [] });
        render(<LogViewerPane loggingPath="/bad/path" />);
        await waitFor(() =>
            expect(screen.getByText('Log folder does not exist')).toBeInTheDocument()
        );
    });

    it('shows "No log files found" when file list is empty', async () => {
        mockListLogFiles.mockResolvedValue({ files: [] });
        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() =>
            expect(screen.getByText('No log files found.')).toBeInTheDocument()
        );
    });

    // ── File list ──

    it('renders file list items', async () => {
        mockListLogFiles.mockResolvedValue({
            files: [
                { name: '20260101120000-SSH-host.txt', path: '/logs/a.txt', mtime: Date.now(), size: 1024 },
                { name: '20260101130000-SSH-host.txt', path: '/logs/b.txt', mtime: Date.now(), size: 2048 },
            ],
        });
        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() => {
            expect(screen.getByText('20260101120000-SSH-host.txt')).toBeInTheDocument();
            expect(screen.getByText('20260101130000-SSH-host.txt')).toBeInTheDocument();
        });
    });

    it('filters file list by name', async () => {
        mockListLogFiles.mockResolvedValue({
            files: [
                { name: 'SSH-host1.txt', path: '/logs/a.txt', mtime: Date.now(), size: 100 },
                { name: 'Telnet-host2.txt', path: '/logs/b.txt', mtime: Date.now(), size: 100 },
            ],
        });
        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() => screen.getByText('SSH-host1.txt'));

        fireEvent.change(screen.getByPlaceholderText('Filter files...'), { target: { value: 'telnet' } });
        expect(screen.queryByText('SSH-host1.txt')).toBeNull();
        expect(screen.getByText('Telnet-host2.txt')).toBeInTheDocument();
    });

    // ── File selection & content ──

    it('shows "Select a file" prompt before any file is selected', async () => {
        mockListLogFiles.mockResolvedValue({ files: [] });
        render(<LogViewerPane loggingPath="/logs" />);
        expect(screen.getByText('Select a file to view its content.')).toBeInTheDocument();
    });

    it('shows content after selecting a file', async () => {
        mockListLogFiles.mockResolvedValue({
            files: [{ name: 'test.txt', path: '/logs/test.txt', mtime: Date.now(), size: 50 }],
        });
        mockReadLogFile.mockImplementation(async (path: string) => {
            if (path.endsWith('.tslog')) return { error: 'File not found' };
            return { content: 'line one\nline two\nline three' };
        });

        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() => screen.getByText('test.txt'));
        fireEvent.click(screen.getByText('test.txt'));

        await waitFor(() => {
            expect(screen.getByText('line one')).toBeInTheDocument();
            expect(screen.getByText('line two')).toBeInTheDocument();
        });
    });

    it('shows error when readLogFile fails', async () => {
        mockListLogFiles.mockResolvedValue({
            files: [{ name: 'big.txt', path: '/logs/big.txt', mtime: Date.now(), size: 999 }],
        });
        mockReadLogFile.mockResolvedValue({ error: 'File too large (60.0 MB). Limit is 50 MB.' });

        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() => screen.getByText('big.txt'));
        fireEvent.click(screen.getByText('big.txt'));

        await waitFor(() =>
            expect(screen.getByText(/File too large/)).toBeInTheDocument()
        );
    });

    // ── Timestamps ──

    it('shows Timestamps toggle when .tslog file exists', async () => {
        mockListLogFiles.mockResolvedValue({
            files: [{ name: 'session.txt', path: '/logs/session.txt', mtime: Date.now(), size: 50 }],
        });
        mockReadLogFile.mockImplementation(async (path: string) => {
            if (path.endsWith('.tslog')) return { content: '2026-01-01 12:00:00.000\n2026-01-01 12:00:01.000' };
            return { content: 'hello\nworld' };
        });

        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() => screen.getByText('session.txt'));
        fireEvent.click(screen.getByText('session.txt'));

        await waitFor(() =>
            expect(screen.getByText('Timestamps')).toBeInTheDocument()
        );
    });

    it('does not show Timestamps toggle when .tslog file is absent', async () => {
        mockListLogFiles.mockResolvedValue({
            files: [{ name: 'session.txt', path: '/logs/session.txt', mtime: Date.now(), size: 50 }],
        });
        mockReadLogFile.mockImplementation(async (path: string) => {
            if (path.endsWith('.tslog')) return { error: 'File not found' };
            return { content: 'hello\nworld' };
        });

        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() => screen.getByText('session.txt'));
        fireEvent.click(screen.getByText('session.txt'));

        await waitFor(() => screen.getByText('hello'));
        expect(screen.queryByText('Timestamps')).toBeNull();
    });

    // ── Sidebar collapse ──

    it('hides file list when sidebar is collapsed', async () => {
        mockListLogFiles.mockResolvedValue({
            files: [{ name: 'test.txt', path: '/logs/test.txt', mtime: Date.now(), size: 50 }],
        });
        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() => screen.getByText('test.txt'));

        fireEvent.click(screen.getByTitle('Collapse file list'));
        expect(screen.queryByText('test.txt')).toBeNull();
    });

    it('restores file list when sidebar is expanded again', async () => {
        mockListLogFiles.mockResolvedValue({
            files: [{ name: 'test.txt', path: '/logs/test.txt', mtime: Date.now(), size: 50 }],
        });
        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() => screen.getByText('test.txt'));

        fireEvent.click(screen.getByTitle('Collapse file list'));
        fireEvent.click(screen.getByTitle('Expand file list'));
        expect(screen.getByText('test.txt')).toBeInTheDocument();
    });

    // ── Search ──

    it('Search button is disabled when query is empty', async () => {
        mockListLogFiles.mockResolvedValue({
            files: [{ name: 'test.txt', path: '/logs/test.txt', mtime: Date.now(), size: 50 }],
        });
        mockReadLogFile.mockImplementation(async (path: string) => {
            if (path.endsWith('.tslog')) return { error: 'not found' };
            return { content: 'foo\nbar' };
        });

        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() => screen.getByText('test.txt'));
        fireEvent.click(screen.getByText('test.txt'));
        await waitFor(() => screen.getByText('foo'));

        expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    });

    it('shows match count after searching', async () => {
        mockListLogFiles.mockResolvedValue({
            files: [{ name: 'test.txt', path: '/logs/test.txt', mtime: Date.now(), size: 50 }],
        });
        mockReadLogFile.mockImplementation(async (path: string) => {
            if (path.endsWith('.tslog')) return { error: 'not found' };
            return { content: 'ERROR: disk full\nWARN: low memory\nERROR: timeout' };
        });

        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() => screen.getByText('test.txt'));
        fireEvent.click(screen.getByText('test.txt'));
        await waitFor(() => screen.getByText(/ERROR: disk full/));

        fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'ERROR' } });
        fireEvent.click(screen.getByRole('button', { name: 'Search' }));

        await waitFor(() =>
            expect(screen.getByText('1 / 2')).toBeInTheDocument()
        );
    });

    it('shows "No matches" when search finds nothing', async () => {
        mockListLogFiles.mockResolvedValue({
            files: [{ name: 'test.txt', path: '/logs/test.txt', mtime: Date.now(), size: 50 }],
        });
        mockReadLogFile.mockImplementation(async (path: string) => {
            if (path.endsWith('.tslog')) return { error: 'not found' };
            return { content: 'hello\nworld' };
        });

        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() => screen.getByText('test.txt'));
        fireEvent.click(screen.getByText('test.txt'));
        await waitFor(() => screen.getByText('hello'));

        fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'zzz' } });
        fireEvent.click(screen.getByRole('button', { name: 'Search' }));

        await waitFor(() =>
            expect(screen.getByText('No matches')).toBeInTheDocument()
        );
    });

    it('shows "Invalid regex" for bad regex pattern', async () => {
        mockListLogFiles.mockResolvedValue({
            files: [{ name: 'test.txt', path: '/logs/test.txt', mtime: Date.now(), size: 50 }],
        });
        mockReadLogFile.mockImplementation(async (path: string) => {
            if (path.endsWith('.tslog')) return { error: 'not found' };
            return { content: 'hello' };
        });

        render(<LogViewerPane loggingPath="/logs" />);
        await waitFor(() => screen.getByText('test.txt'));
        fireEvent.click(screen.getByText('test.txt'));
        await waitFor(() => screen.getByText('hello'));

        fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: '[bad' } });
        fireEvent.click(screen.getByRole('checkbox', { name: '.*' })); // enable regex mode
        fireEvent.click(screen.getByRole('button', { name: 'Search' }));

        await waitFor(() =>
            expect(screen.getByText('Invalid regex')).toBeInTheDocument()
        );
    });
});
