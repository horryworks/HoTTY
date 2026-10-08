import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePaneFindShortcut } from '../../hooks/usePaneFindShortcut';
import { recallPaneMemory, useRememberPane } from '../../hooks/usePaneMemory';
import {
  MAX_MATCHES,
  buildSearchRegex,
  filterMatchingLines,
  splitByMatches,
  type Segment,
} from './logSearch';
import {
  MAX_CSV_ROWS,
  buildCsvView,
  isCsvFile,
  parseCsv,
  type CsvCell,
} from './logCsv';
import { MAX_MARKDOWN_BYTES, highlightHtml, isMarkdownFile } from './logMarkdown';
import { MarkdownContent } from '../MarkdownContent/MarkdownContent';
import { renderMarkdown } from '../../utils/markdown';
import { Segmented } from '../PaneTools/PaneTools';
import { describeLogFile, followInterval, groupByDay, isLive } from './logFileInfo';
import type { LogFile } from '../../types/appTypes';
import './LogViewerPane.css';

interface LogViewerPaneProps {
  paneId: string;
  active: boolean;
}

/** How often the file list is read again. */
const LIST_REFRESH_MS = 5000;
/** Scrolled this far above the end, the reader is reading — stop following. */
const FOLLOW_SLACK_PX = 40;
/** Re-scan the log at most this often while the user is still typing. */
const SEARCH_DEBOUNCE_MS = 150;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(mtime: number): string {
  if (!mtime) return '';
  return new Date(mtime).toLocaleString();
}

function formatTime(mtime: number): string {
  if (!mtime) return '';
  return new Date(mtime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function LogViewerPane({ paneId, active }: LogViewerPaneProps) {
  const { t } = useTranslation();
  const loggingPath = useSettingsStore((s) => s.loggingPath);
  // Where the reader was, kept when the tab is hidden and shown again.
  const [folderPath, setFolderPath] = useState(() => recallPaneMemory(paneId, 'folder', loggingPath));
  const [files, setFiles] = useState<LogFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<LogFile | null>(() => recallPaneMemory(paneId, 'file', null));
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  // Keep showing the end of the open file as it grows.
  const [follow, setFollow] = useState(() => recallPaneMemory(paneId, 'follow', false));
  useRememberPane(paneId, { 'folder': folderPath, 'file': selectedFile, 'follow': follow });
  // When the file list was last read: drives "Today", "Yesterday" and the
  // "being written" dot without a clock re-rendering the pane every second.
  const [listedAt, setListedAt] = useState(() => Date.now());
  // In-log search
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [filterOnly, setFilterOnly] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  // A .csv opens as a table; the toggle lets the user drop back to raw text.
  const [csvAsTable, setCsvAsTable] = useState(true);
  // A .md opens formatted, for the same reason. Like `csvAsTable` this is a
  // pane-level preference, not per-file — flipping to the source stays flipped
  // while the user walks the file list.
  const [mdRendered, setMdRendered] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const currentMatchRef = useRef<HTMLElement | null>(null);
  const mdRef = useRef<HTMLDivElement>(null);

  /**
   * Read the folder's file list. A quiet read (the periodic refresh) leaves the
   * loading state, the error and the approval prompt alone, so it never
   * flickers the pane or pops a dialog on its own.
   */
  const loadFiles = useCallback(async (path: string, quiet = false): Promise<LogFile[] | null> => {
    if (!path) return null;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      let result = await tauriService.listLogFiles(path);
      // If the backend rejected because the folder isn't user-approved yet,
      // ask via a native confirm dialog and retry once. The dialog is what
      // gates this — a compromised renderer can call `confirmLogDir` but
      // cannot fake the OS-level click.
      if (!quiet && result.error?.includes('not approved')) {
        const ok = await tauriService.confirmLogDir(path);
        if (ok) {
          result = await tauriService.listLogFiles(path);
        }
      }
      if (result.error) {
        if (!quiet) {
          setError(result.error);
          setFiles([]);
        }
        return null;
      }
      const list = result.files ?? [];
      // Keep the old array when nothing changed, so a refresh re-renders nothing.
      setFiles((prev) =>
        prev.length === list.length && prev.every((f, i) => f.path === list[i].path && f.size === list[i].size && f.mtime === list[i].mtime)
          ? prev
          : list,
      );
      setListedAt(Date.now());
      return list;
    } catch (e) {
      if (!quiet) {
        setError(String(e));
        setFiles([]);
      }
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadContent = useCallback(async (file: LogFile, quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await tauriService.readLogFile(file.path);
      if (result.error) {
        if (!quiet) {
          setError(result.error);
          setContent('');
        }
      } else {
        setContent(result.content ?? '');
      }
    } catch (e) {
      if (!quiet) {
        setError(String(e));
        setContent('');
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const openFolder = useCallback((path: string) => {
    setFolderPath(path);
    setSelectedFile(null);
    setContent('');
    setFollow(false);
    void loadFiles(path);
  }, [loadFiles]);

  const handleChooseFolder = useCallback(async () => {
    try {
      const dir = await tauriService.selectFolder();
      if (dir) openFolder(dir);
    } catch (e) {
      setError(String(e));
    }
  }, [openFolder]);

  const handleSelectFile = useCallback((file: LogFile) => {
    setSelectedFile(file);
    // A file still being written opens following its end; an old one opens at the top.
    setFollow(isLive(file, Date.now()));
    void loadContent(file);
  }, [loadContent]);

  // Sync folder path from settings when loggingPath changes
  useEffect(() => {
    if (loggingPath && loggingPath !== folderPath) openFolder(loggingPath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggingPath]);

  // Load files on mount if a folder is set, and the open file when the tab
  // comes back from being hidden.
  useEffect(() => {
    if (folderPath) void loadFiles(folderPath);
    if (selectedFile) void loadContent(selectedFile);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the list current, and while following, reload the open file when it
  // grew. The size and time come from the list, so an unchanged file is never
  // read again.
  useEffect(() => {
    if (!folderPath) return;
    const id = setInterval(async () => {
      const list = await loadFiles(folderPath, true);
      if (!follow || !selectedFile || !list) return;
      const fresh = list.find((f) => f.path === selectedFile.path);
      if (fresh && (fresh.size !== selectedFile.size || fresh.mtime !== selectedFile.mtime)) {
        setSelectedFile(fresh);
        void loadContent(fresh, true);
      }
    }, follow && selectedFile ? followInterval(selectedFile.size) : LIST_REFRESH_MS);
    return () => clearInterval(id);
  }, [folderPath, follow, selectedFile, loadFiles, loadContent]);

  const filteredFiles = useMemo(() => {
    if (!filterText) return files;
    const lower = filterText.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(lower) || describeLogFile(f.name).title.toLowerCase().includes(lower));
  }, [files, filterText]);

  const groups = useMemo(() => groupByDay(filteredFiles, listedAt), [filteredFiles, listedAt]);

  // ---- In-log search -------------------------------------------------------

  // Debounce so a keystroke doesn't rescan a multi-megabyte log 10×/second.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchQuery]);

  const searchRegex = useMemo(
    () => buildSearchRegex(debouncedQuery, { caseSensitive, useRegex }),
    [debouncedQuery, caseSensitive, useRegex],
  );
  const regexInvalid = debouncedQuery.length > 0 && searchRegex === null;

  // ---- CSV table view ------------------------------------------------------

  const isCsv = !!selectedFile && isCsvFile(selectedFile.name);
  const showCsvTable = isCsv && csvAsTable;

  const csvTable = useMemo(
    () => (showCsvTable ? parseCsv(content) : null),
    [showCsvTable, content],
  );

  // Search runs over the cells rather than the raw line, so a highlight can
  // never straddle a comma that the table has already turned into a column edge.
  const csvView = useMemo(
    () => (csvTable ? buildCsvView(csvTable, searchRegex, filterOnly) : null),
    [csvTable, searchRegex, filterOnly],
  );

  // ---- Markdown view -------------------------------------------------------

  const isMd = !!selectedFile && isMarkdownFile(selectedFile.name);
  // Formatting is synchronous (marked, then a walk over every text node), so a
  // huge file would freeze the pane. Past the cap it stays raw text.
  const mdTooLarge = isMd && content.length > MAX_MARKDOWN_BYTES;
  const showMarkdown = isMd && mdRendered && !mdTooLarge;

  const mdHtml = useMemo(
    () => (showMarkdown ? renderMarkdown(content) : null),
    [showMarkdown, content],
  );

  // Split from `mdHtml` on purpose: stepping through matches only toggles a
  // class on one <mark> (see the effect below), so neither the markdown parse
  // nor the highlight walk re-runs on next/previous.
  const mdHighlight = useMemo(
    () => (mdHtml !== null && searchRegex ? highlightHtml(mdHtml, searchRegex, MAX_MATCHES) : null),
    [mdHtml, searchRegex],
  );

  // Highlight mode: one <pre> whose children alternate plain text and <mark>,
  // so the DOM cost is O(matches) rather than O(lines).
  const highlight = useMemo(
    () =>
      !showCsvTable && !showMarkdown && searchRegex && !filterOnly
        ? splitByMatches(content, searchRegex, MAX_MATCHES)
        : null,
    [showCsvTable, showMarkdown, content, searchRegex, filterOnly],
  );

  // Filter mode: only the lines that contain a match.
  const filtered = useMemo(
    () =>
      !showCsvTable && !showMarkdown && searchRegex && filterOnly
        ? filterMatchingLines(content, searchRegex, MAX_MATCHES)
        : null,
    [showCsvTable, showMarkdown, content, searchRegex, filterOnly],
  );

  // Pre-split each surviving line once, so stepping through matches doesn't
  // re-scan every visible row.
  const filteredRows = useMemo(
    () =>
      filtered && searchRegex
        ? filtered.lines.map((line) => splitByMatches(line, searchRegex, MAX_MATCHES).segments)
        : null,
    [filtered, searchRegex],
  );

  const matchCount =
    csvView?.total ?? mdHighlight?.total ?? highlight?.total ?? filtered?.lines.length ?? 0;
  const matchesTruncated =
    csvView?.truncated ?? mdHighlight?.truncated ?? highlight?.truncated ?? filtered?.truncated ?? false;
  // Clamp during render so a shrinking result set can never index out of range
  // before the reset effect below runs.
  const currentMatch = matchCount === 0 ? 0 : Math.min(matchIndex, matchCount - 1);

  // Back to the first match whenever the search or the open file changes.
  const selectedPath = selectedFile?.path ?? null;
  useEffect(() => {
    setMatchIndex(0);
  }, [debouncedQuery, caseSensitive, useRegex, filterOnly, csvAsTable, mdRendered, selectedPath]);

  // Bring the focused match into view. No smooth scrolling — keep it snappy.
  useEffect(() => {
    currentMatchRef.current?.scrollIntoView({ block: 'center' });
  }, [currentMatch, highlight, filtered, csvView]);

  // The markdown view is set through innerHTML, so its <mark>s cannot carry a
  // React ref. Focus them by their ordinal instead: a class swap on two
  // elements, with no re-render of the document.
  //
  // `loading` is a dependency because a refresh unmounts the view and mounts a
  // fresh copy of the same HTML — `currentMatch` and `mdHighlight` are
  // unchanged, so without it the new copy would never get its `.current`.
  useEffect(() => {
    const root = mdRef.current;
    if (!root) return;
    root.querySelector('.log-viewer-mark.current')?.classList.remove('current');
    const el = root.querySelector<HTMLElement>(`.log-viewer-mark[data-match-index="${currentMatch}"]`);
    if (!el) return;
    el.classList.add('current');
    el.scrollIntoView({ block: 'center' });
  }, [currentMatch, mdHighlight, loading]);

  const setCurrentMatchRef = useCallback((el: HTMLElement | null) => {
    currentMatchRef.current = el;
  }, []);

  const goToMatch = useCallback((delta: number) => {
    setMatchIndex((prev) => {
      if (matchCount === 0) return 0;
      const base = Math.min(prev, matchCount - 1);
      return (base + delta + matchCount) % matchCount;
    });
  }, [matchCount]);

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const goToNext = useCallback(() => goToMatch(1), [goToMatch]);
  const goToPrev = useCallback(() => goToMatch(-1), [goToMatch]);

  usePaneFindShortcut(active, { onFind: focusSearch, onNext: goToNext, onPrev: goToPrev });

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      goToMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (searchQuery) setSearchQuery('');
      else searchInputRef.current?.blur();
    }
  };

  const countLabel = useMemo(() => {
    if (regexInvalid) return t('panes.logViewer.invalidRegex');
    if (!debouncedQuery) return '';
    if (matchCount === 0) return t('panes.logViewer.noMatches');
    const params = { current: currentMatch + 1, total: matchCount };
    return matchesTruncated
      ? t('panes.logViewer.matchCountTruncated', params)
      : t('panes.logViewer.matchCount', params);
  }, [regexInvalid, debouncedQuery, matchCount, currentMatch, matchesTruncated, t]);

  /**
   * Render segments as plain strings interleaved with <mark> elements.
   * `firstOrdinal` is the global ordinal of the first match in `segments`;
   * null when none of them can be the current match.
   */
  const renderSegments = (segments: Segment[], firstOrdinal: number | null) => {
    let seen = -1;
    return segments.map((seg, i) => {
      if (!seg.isMatch) return seg.text;
      seen += 1;
      const isCurrent = firstOrdinal !== null && firstOrdinal + seen === currentMatch;
      return (
        <mark
          key={i}
          className={`log-viewer-mark${isCurrent ? ' current' : ''}`}
          ref={isCurrent ? setCurrentMatchRef : null}
        >
          {seg.text}
        </mark>
      );
    });
  };

  /** Render one table cell, highlighting its matches by their global ordinal. */
  const renderCell = (cell: CsvCell) => {
    // Overwhelmingly the common case — collapse to a plain string so a table
    // with thousands of rows does not allocate an element per cell.
    if (cell.matchStart < 0) return cell.segments.map((seg) => seg.text).join('');
    return renderSegments(cell.segments, cell.matchStart);
  };

  const selectedInfo = selectedFile ? describeLogFile(selectedFile.name) : null;

  // While following, keep the end in view as the file grows — unless a search
  // is open, which scrolls to its own match.
  useEffect(() => {
    if (!follow || debouncedQuery || loading) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [follow, content, debouncedQuery, loading]);

  // Scrolling up to read stops following, as in a terminal.
  const handleContentScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!follow || !el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > FOLLOW_SLACK_PX) setFollow(false);
  }, [follow]);

  const groupLabel = (key: string) =>
    key === 'today' ? t('panes.logViewer.today') : key === 'yesterday' ? t('panes.logViewer.yesterday') : key;

  return (
    <div className={`log-viewer-pane${active ? ' active' : ''}`} data-pane-id={paneId}>
      <div className="log-viewer-toolbar">
        <span className="log-viewer-toolbar-title">{t('panes.logViewer.title')}</span>
        <button
          type="button"
          className={`log-viewer-folder-btn${folderPath ? '' : ' empty'}`}
          onClick={() => void handleChooseFolder()}
          title={folderPath ? t('panes.logViewer.changeFolder') : undefined}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
          </svg>
          <span className="log-viewer-folder-path">{folderPath || t('panes.logViewer.chooseFolder')}</span>
        </button>
        <span className="log-viewer-toolbar-spacer" />
        <input
          type="text"
          className="log-viewer-filter-input"
          placeholder={t('panes.logViewer.filterPlaceholder')}
          aria-label={t('panes.logViewer.filterPlaceholder')}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
      </div>

      {error && <div className="log-viewer-error" role="alert">{error}</div>}

      <div className="log-viewer-content">
        <div className="log-viewer-file-list">
          {filteredFiles.length === 0 && folderPath && !loading && !error && (
            <div className="log-viewer-empty">{t('panes.logViewer.noFiles')}</div>
          )}
          {groups.map((group) => (
            <div key={group.key} className="log-viewer-file-group">
              <div className="log-viewer-group-label">{groupLabel(group.key)}</div>
              {group.files.map((file) => {
                const info = describeLogFile(file.name);
                const live = isLive(file, listedAt);
                return (
                  <button
                    type="button"
                    key={file.path}
                    className={`log-viewer-file-item${selectedFile?.path === file.path ? ' selected' : ''}`}
                    onClick={() => handleSelectFile(file)}
                    title={file.name}
                  >
                    <span className={`log-viewer-badge ${info.kind}`}>{info.badge}</span>
                    <span className="log-viewer-file-text">
                      <span className="log-viewer-file-name">
                        {info.title}
                        {live && <span className="log-viewer-live" title={t('panes.logViewer.writing')} />}
                      </span>
                      <span className="log-viewer-file-meta">
                        {formatTime(file.mtime)} &middot; {formatSize(file.size)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="log-viewer-main">
          {selectedFile && selectedInfo && (
            <div className="log-viewer-file-head">
              <span className={`log-viewer-badge ${selectedInfo.kind}`}>{selectedInfo.badge}</span>
              <span className="log-viewer-file-head-title" title={selectedFile.path}>{selectedInfo.title}</span>
              <span className="log-viewer-file-head-meta">
                {formatDate(selectedFile.mtime)} &middot; {formatSize(selectedFile.size)}
              </span>
              <span className="log-viewer-toolbar-spacer" />
              {isCsv && (
                <Segmented
                  options={[
                    { value: 'table', label: t('panes.logViewer.viewTable') },
                    { value: 'text', label: t('panes.logViewer.viewText') },
                  ]}
                  value={csvAsTable ? 'table' : 'text'}
                  onChange={(v) => setCsvAsTable(v === 'table')}
                  ariaLabel={t('panes.logViewer.viewAria')}
                />
              )}
              {isMd && (
                <Segmented
                  options={[
                    { value: 'formatted', label: t('panes.logViewer.viewFormatted') },
                    { value: 'text', label: t('panes.logViewer.viewText') },
                  ]}
                  value={mdRendered ? 'formatted' : 'text'}
                  onChange={(v) => setMdRendered(v === 'formatted')}
                  ariaLabel={t('panes.logViewer.viewAria')}
                />
              )}
              <button
                type="button"
                className={`log-viewer-follow${follow ? ' on' : ''}`}
                aria-pressed={follow}
                onClick={() => setFollow((v) => !v)}
              >
                ↓ {t('panes.logViewer.follow')}
              </button>
            </div>
          )}

          {selectedFile && (
            <div className="log-viewer-search-bar">
              <div className="log-viewer-search-box">
                <input
                  ref={searchInputRef}
                  type="text"
                  className={`log-viewer-search-input${regexInvalid ? ' invalid' : ''}`}
                  placeholder={t('panes.logViewer.searchPlaceholder')}
                  aria-label={t('panes.logViewer.searchAria')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="log-viewer-search-clear"
                    onClick={() => { setSearchQuery(''); focusSearch(); }}
                    title={t('panes.logViewer.clearSearch')}
                    aria-label={t('panes.logViewer.clearSearch')}
                  >
                    &times;
                  </button>
                )}
                <button
                  type="button"
                  className={`log-viewer-search-toggle${caseSensitive ? ' active' : ''}`}
                  onClick={() => setCaseSensitive((v) => !v)}
                  title={t('panes.logViewer.caseSensitive')}
                  aria-label={t('panes.logViewer.caseSensitive')}
                  aria-pressed={caseSensitive}
                >
                  Aa
                </button>
                <button
                  type="button"
                  className={`log-viewer-search-toggle${useRegex ? ' active' : ''}`}
                  onClick={() => setUseRegex((v) => !v)}
                  title={t('panes.logViewer.useRegex')}
                  aria-label={t('panes.logViewer.useRegex')}
                  aria-pressed={useRegex}
                >
                  .*
                </button>
              </div>
              <span
                className="log-viewer-search-count"
                title={matchesTruncated ? t('panes.logViewer.tooManyMatches', { limit: MAX_MATCHES }) : undefined}
              >
                {countLabel}
              </span>
              <button
                type="button"
                className="log-viewer-search-btn"
                onClick={goToPrev}
                disabled={matchCount === 0}
                title={t('panes.logViewer.prevMatch')}
                aria-label={t('panes.logViewer.prevMatch')}
              >
                &#9650;
              </button>
              <button
                type="button"
                className="log-viewer-search-btn"
                onClick={goToNext}
                disabled={matchCount === 0}
                title={t('panes.logViewer.nextMatch')}
                aria-label={t('panes.logViewer.nextMatch')}
              >
                &#9660;
              </button>
              <Segmented
                options={[
                  { value: 'all', label: t('panes.logViewer.linesAll') },
                  { value: 'matching', label: t('panes.logViewer.linesMatching') },
                ]}
                value={filterOnly && !showMarkdown ? 'matching' : 'all'}
                onChange={(v) => setFilterOnly(v === 'matching')}
                ariaLabel={t('panes.logViewer.linesAria')}
                disabled={showMarkdown}
              />
            </div>
          )}

          <div className="log-viewer-file-content" ref={scrollerRef} onScroll={handleContentScroll}>
            {loading && <div className="log-viewer-loading">{t('common.loading')}</div>}
            {!loading && selectedFile && csvView && csvTable && (
              csvView.rows.length === 0 ? (
                <>
                  {/* "No matches" only covers the rows that were parsed. */}
                  {csvTable.truncated && (
                    <div className="log-viewer-csv-notice">
                      {t('panes.logViewer.csvTruncated', { limit: MAX_CSV_ROWS })}
                    </div>
                  )}
                  <div className="log-viewer-placeholder">
                    {filterOnly && searchRegex
                      ? t('panes.logViewer.noMatches')
                      : t('panes.logViewer.csvEmpty')}
                  </div>
                </>
              ) : (
                <div className="log-viewer-csv">
                  {csvTable.truncated && (
                    <div className="log-viewer-csv-notice">
                      {t('panes.logViewer.csvTruncated', { limit: MAX_CSV_ROWS })}
                    </div>
                  )}
                  <table className="log-viewer-csv-table">
                    <thead>
                      <tr>
                        {csvView.header.map((label, i) => (
                          <th key={i}>{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvView.rows.map((row, r) => (
                        <tr key={r}>
                          {row.cells.map((cell, c) => (
                            <td key={c}>{renderCell(cell)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
            {!loading && selectedFile && showMarkdown && (
              <div className="log-viewer-md" ref={mdRef}>
                <MarkdownContent sanitizedHtml={mdHighlight?.html ?? mdHtml ?? ''} />
              </div>
            )}
            {!loading && selectedFile && !csvView && filteredRows && (
              filteredRows.length === 0 ? (
                <div className="log-viewer-placeholder">{t('panes.logViewer.noMatches')}</div>
              ) : (
                <div className="log-viewer-filtered">
                  {filteredRows.map((segments, i) => {
                    const isCurrent = i === currentMatch;
                    return (
                      <div
                        key={i}
                        className={`log-viewer-match-line${isCurrent ? ' current' : ''}`}
                        ref={isCurrent ? setCurrentMatchRef : null}
                      >
                        {renderSegments(segments, null)}
                      </div>
                    );
                  })}
                </div>
              )
            )}
            {!loading && selectedFile && !csvView && !showMarkdown && !filteredRows && (
              <>
                {mdTooLarge && mdRendered && (
                  <div className="log-viewer-md-notice">
                    {t('panes.logViewer.mdTooLarge')}
                  </div>
                )}
                <pre className="log-viewer-pre">
                  {highlight ? renderSegments(highlight.segments, 0) : content}
                </pre>
              </>
            )}
            {!loading && !selectedFile && folderPath && (
              <div className="log-viewer-placeholder">{t('panes.logViewer.selectFile')}</div>
            )}
            {!loading && !folderPath && (
              <div className="log-viewer-placeholder">
                <button type="button" className="log-viewer-link-btn" onClick={() => void handleChooseFolder()}>
                  {t('panes.logViewer.chooseFolder')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
