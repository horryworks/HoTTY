import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import { useResize } from '../../hooks/useResize';
import { usePaneFindShortcut } from '../../hooks/usePaneFindShortcut';
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
import type { LogFile } from '../../types/appTypes';
import './LogViewerPane.css';

interface LogViewerPaneProps {
  paneId: string;
  active: boolean;
}

const MIN_PANEL_RATIO = 0.15;
const MAX_PANEL_RATIO = 0.6;
const DEFAULT_PANEL_RATIO = 0.3;
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

export function LogViewerPane({ paneId, active }: LogViewerPaneProps) {
  const { t } = useTranslation();
  const loggingPath = useSettingsStore((s) => s.loggingPath);
  const [folderPath, setFolderPath] = useState(loggingPath);
  const [folderInput, setFolderInput] = useState(loggingPath);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<LogFile | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [panelRatio, setPanelRatio] = useState(DEFAULT_PANEL_RATIO);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const ratioBeforeCollapse = useRef(DEFAULT_PANEL_RATIO);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const currentMatchRef = useRef<HTMLElement | null>(null);
  const mdRef = useRef<HTMLDivElement>(null);

  const { startResize } = useResize({
    orientation: 'horizontal',
    onMove: (dx) => {
      setPanelRatio((prev) => {
        const containerW = contentRef.current?.clientWidth ?? 600;
        const delta = dx / containerW;
        return Math.max(MIN_PANEL_RATIO, Math.min(MAX_PANEL_RATIO, prev + delta));
      });
    },
  });

  const toggleCollapse = useCallback(() => {
    setPanelCollapsed((prev) => {
      if (!prev) {
        ratioBeforeCollapse.current = panelRatio;
      } else {
        setPanelRatio(ratioBeforeCollapse.current);
      }
      return !prev;
    });
  }, [panelRatio]);

  const loadFiles = useCallback(async (path: string) => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      let result = await tauriService.listLogFiles(path);
      // If the backend rejected because the folder isn't user-approved yet,
      // ask via a native confirm dialog and retry once. The dialog is what
      // gates this — a compromised renderer can call `confirmLogDir` but
      // cannot fake the OS-level click.
      if (result.error?.includes('not approved')) {
        const ok = await tauriService.confirmLogDir(path);
        if (ok) {
          result = await tauriService.listLogFiles(path);
        }
      }
      if (result.error) {
        setError(result.error);
        setFiles([]);
      } else {
        setFiles(result.files ?? []);
      }
    } catch (e) {
      setError(String(e));
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContent = useCallback(async (file: LogFile) => {
    setLoading(true);
    setError(null);
    try {
      const result = await tauriService.readLogFile(file.path);
      if (result.error) {
        setError(result.error);
        setContent('');
      } else {
        setContent(result.content ?? '');
      }
    } catch (e) {
      setError(String(e));
      setContent('');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenFolder = useCallback(() => {
    const path = folderInput.trim();
    if (path) {
      setFolderPath(path);
      setSelectedFile(null);
      setContent('');
      loadFiles(path);
    }
  }, [folderInput, loadFiles]);

  const handleRefresh = useCallback(() => {
    if (folderPath) loadFiles(folderPath);
  }, [folderPath, loadFiles]);

  const handleSelectFile = useCallback((file: LogFile) => {
    setSelectedFile(file);
    loadContent(file);
  }, [loadContent]);

  // Sync folder path from settings when loggingPath changes
  useEffect(() => {
    if (loggingPath && loggingPath !== folderPath) {
      setFolderPath(loggingPath);
      setFolderInput(loggingPath);
      setSelectedFile(null);
      setContent('');
      loadFiles(loggingPath);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggingPath]);

  // Load files on mount if loggingPath is set
  useEffect(() => {
    if (folderPath) loadFiles(folderPath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh && folderPath) {
      intervalRef.current = setInterval(() => loadFiles(folderPath), 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, folderPath, loadFiles]);

  // Enter key in folder input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleOpenFolder();
  };

  const filteredFiles = useMemo(() => {
    if (!filterText) return files;
    const lower = filterText.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(lower));
  }, [files, filterText]);

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
  useEffect(() => {
    const root = mdRef.current;
    if (!root) return;
    root.querySelector('.log-viewer-mark.current')?.classList.remove('current');
    const el = root.querySelector<HTMLElement>(`.log-viewer-mark[data-match-index="${currentMatch}"]`);
    if (!el) return;
    el.classList.add('current');
    el.scrollIntoView({ block: 'center' });
  }, [currentMatch, mdHighlight]);

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

  /** Render segments as plain strings interleaved with <mark> elements. */
  const renderSegments = (segments: Segment[], markCurrent: boolean) => {
    let seen = -1;
    return segments.map((seg, i) => {
      if (!seg.isMatch) return seg.text;
      seen += 1;
      const isCurrent = markCurrent && seen === currentMatch;
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
    let seen = -1;
    return cell.segments.map((seg, i) => {
      if (!seg.isMatch) return seg.text;
      seen += 1;
      const isCurrent = cell.matchStart + seen === currentMatch;
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

  const hasFolderSet = !!folderPath;

  return (
    <div className={`log-viewer-pane${active ? ' active' : ''}`} data-pane-id={paneId}>
      {hasFolderSet ? (
        <div className="log-viewer-toolbar">
          <span className="log-viewer-toolbar-title">{t('panes.logViewer.title')}</span>
          <span className="log-viewer-toolbar-path" title={folderPath}>{folderPath}</span>
          <span className="log-viewer-toolbar-spacer" />
          <label className="log-viewer-auto-refresh">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            {t('panes.logViewer.auto')}
          </label>
        </div>
      ) : (
        <div className="log-viewer-toolbar">
          <input
            type="text"
            className="log-viewer-folder-input"
            placeholder={t('panes.logViewer.folderPlaceholder')}
            value={folderInput}
            onChange={(e) => setFolderInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="log-viewer-toolbar-btn"
            onClick={handleOpenFolder}
            disabled={!folderInput.trim()}
            title={t('panes.logViewer.openTitle')}
          >
            {t('panes.logViewer.open')}
          </button>
        </div>
      )}

      <div className="log-viewer-content" ref={contentRef}>
        {!panelCollapsed && (
          <div className="log-viewer-file-list" style={{ width: `${panelRatio * 100}%` }}>
            <div className="log-viewer-filter-bar">
              <input
                type="text"
                className="log-viewer-filter-input"
                placeholder={t('panes.logViewer.filterPlaceholder')}
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="log-viewer-refresh-btn"
              onClick={handleRefresh}
              disabled={!folderPath}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              {t('panes.logViewer.refresh')}
            </button>
            {error && <div className="log-viewer-error">{error}</div>}
            <div className="log-viewer-file-items">
              {filteredFiles.length === 0 && folderPath && !loading && !error && (
                <div className="log-viewer-empty">{t('panes.logViewer.noFiles')}</div>
              )}
              {filteredFiles.map((file) => (
                <div
                  key={file.path}
                  className={`log-viewer-file-item${selectedFile?.path === file.path ? ' selected' : ''}`}
                  onClick={() => handleSelectFile(file)}
                  title={file.path}
                >
                  <span className="log-viewer-file-name">{file.name}</span>
                  <span className="log-viewer-file-meta">
                    {formatSize(file.size)} &middot; {formatDate(file.mtime)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="log-viewer-divider">
          <div className="log-viewer-divider-handle" onMouseDown={startResize} />
          <button
            type="button"
            className={`log-viewer-divider-toggle${panelCollapsed ? ' collapsed' : ''}`}
            onClick={toggleCollapse}
            title={panelCollapsed ? t('panes.logViewer.showFileList') : t('panes.logViewer.hideFileList')}
          >
            <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
              <path d={panelCollapsed ? 'M2 0l6 6-6 6z' : 'M6 0L0 6l6 6z'} />
            </svg>
          </button>
        </div>

        <div className="log-viewer-main">
          {selectedFile && (
            <div className="log-viewer-search-bar">
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
              {isCsv && (
                <button
                  type="button"
                  className={`log-viewer-search-toggle${csvAsTable ? ' active' : ''}`}
                  onClick={() => setCsvAsTable((v) => !v)}
                  title={t('panes.logViewer.tableView')}
                  aria-label={t('panes.logViewer.tableView')}
                  aria-pressed={csvAsTable}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="1" />
                    <path d="M3 9h18M3 15h18M9 3v18" />
                  </svg>
                </button>
              )}
              {isMd && (
                <button
                  type="button"
                  className={`log-viewer-search-toggle${mdRendered ? ' active' : ''}`}
                  onClick={() => setMdRendered((v) => !v)}
                  title={t('panes.logViewer.renderedView')}
                  aria-label={t('panes.logViewer.renderedView')}
                  aria-pressed={mdRendered}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 5h16M4 10h16M4 15h11M4 20h7" />
                  </svg>
                </button>
              )}
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
              <span
                className="log-viewer-search-count"
                title={matchesTruncated ? t('panes.logViewer.tooManyMatches', { limit: MAX_MATCHES }) : undefined}
              >
                {countLabel}
              </span>
              <label className={`log-viewer-search-filter-toggle${showMarkdown ? ' disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={filterOnly}
                  disabled={showMarkdown}
                  onChange={(e) => setFilterOnly(e.target.checked)}
                />
                {t('panes.logViewer.onlyMatchingLines')}
              </label>
            </div>
          )}

          <div className="log-viewer-file-content">
            {loading && <div className="log-viewer-loading">{t('common.loading')}</div>}
            {!loading && selectedFile && csvView && csvTable && (
              csvView.rows.length === 0 ? (
                <div className="log-viewer-placeholder">
                  {filterOnly && searchRegex
                    ? t('panes.logViewer.noMatches')
                    : t('panes.logViewer.csvEmpty')}
                </div>
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
                        {renderSegments(segments, false)}
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
                  {highlight ? renderSegments(highlight.segments, true) : content}
                </pre>
              </>
            )}
            {!loading && !selectedFile && folderPath && (
              <div className="log-viewer-placeholder">{t('panes.logViewer.selectFile')}</div>
            )}
            {!loading && !folderPath && (
              <div className="log-viewer-placeholder">{t('panes.logViewer.enterFolder')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
