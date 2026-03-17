import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as electronService from '../../services/electronService';
import type { AskGeminiCommand } from '../../types/appTypes';
import './LogViewerPane.css';

interface LogFile {
    name: string;
    path: string;
    mtime: number;
    size: number;
}

interface LogViewerPaneProps {
    loggingPath: string;
    askGeminiCommands?: AskGeminiCommand[];
}

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (ms: number): string => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// eslint-disable-next-line react-refresh/only-export-components
export const buildRegex = (query: string, useRegex: boolean): RegExp | null => {
    if (!query) return null;
    try {
        const source = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(source, 'gi');
    } catch {
        return null;
    }
};

const highlightLine = (line: string, regex: RegExp): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    const globalRegex = new RegExp(regex.source, 'gi');
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = globalRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
            parts.push(line.slice(lastIndex, match.index));
        }
        parts.push(<mark key={key++} className="log-search-mark">{match[0]}</mark>);
        lastIndex = globalRegex.lastIndex;
        if (match[0].length === 0) globalRegex.lastIndex++;
    }
    if (lastIndex < line.length) parts.push(line.slice(lastIndex));
    return parts.length > 0 ? <>{parts}</> : line;
};

export const LogViewerPane: React.FC<LogViewerPaneProps> = ({ loggingPath, askGeminiCommands = [] }) => {
    // File list state
    const [files, setFiles] = useState<LogFile[]>([]);
    const [listError, setListError] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<LogFile | null>(null);
    const [content, setContent] = useState<string | null>(null);
    const [contentError, setContentError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [fileFilter, setFileFilter] = useState('');

    // Sidebar collapse
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    // Timestamp state
    const [timestamps, setTimestamps] = useState<string[] | null>(null);
    const [showTimestamps, setShowTimestamps] = useState(true);

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [useRegex, setUseRegex] = useState(false);
    const [regexError, setRegexError] = useState(false);
    const [matchingLines, setMatchingLines] = useState<number[]>([]);
    const [currentMatch, setCurrentMatch] = useState(0);
    const [activeRegex, setActiveRegex] = useState<RegExp | null>(null);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Ctrl+F to focus search input
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    const lines = useMemo(() => content ? content.split('\n') : [], [content]);
    const matchingSet = useMemo(() => new Set(matchingLines), [matchingLines]);
    const hasTimestamps = timestamps !== null && timestamps.length > 0;

    // ── Virtual scroller ──
    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer({
        count: lines.length,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: () => 20,
        overscan: 15,
    });

    // ── File loading ──

    const loadFiles = useCallback(async () => {
        if (!loggingPath) {
            setListError('No log folder configured. Set it in Settings → Logging.');
            setFiles([]);
            return;
        }
        const result = await electronService.listLogFiles(loggingPath);
        if (result.error) {
            setListError(result.error);
            setFiles([]);
        } else {
            setListError(null);
            setFiles(result.files || []);
        }
    }, [loggingPath]);

    useEffect(() => { loadFiles(); }, [loadFiles]);

    const handleSelectFile = async (file: LogFile) => {
        setSelectedFile(file);
        setContent(null);
        setContentError(null);
        setTimestamps(null);
        setLoading(true);
        setMatchingLines([]);
        setCurrentMatch(0);
        setActiveRegex(null);

        const result = await electronService.readLogFile(file.path);
        setLoading(false);
        if (result.error) {
            setContentError(result.error);
        } else {
            setContent(result.content ?? null);
            const tsPath = file.path.replace(/\.(txt|log)$/i, '.tslog');
            const tsResult = await electronService.readLogFile(tsPath);
            if (!tsResult.error && tsResult.content != null) {
                setTimestamps(tsResult.content.split('\n'));
            }
        }
    };

    // ── Search ──

    const runSearch = useCallback((query: string, isRegex: boolean, fileContent: string | null) => {
        if (!query || !fileContent) {
            setMatchingLines([]);
            setCurrentMatch(0);
            setActiveRegex(null);
            setRegexError(false);
            return;
        }
        const regex = buildRegex(query, isRegex);
        if (!regex) {
            setRegexError(true);
            setMatchingLines([]);
            setActiveRegex(null);
            return;
        }
        setRegexError(false);
        setActiveRegex(regex);

        const splitLines = fileContent.split('\n');
        const indices: number[] = [];
        splitLines.forEach((line, idx) => {
            regex.lastIndex = 0;
            if (regex.test(line)) indices.push(idx);
        });
        setMatchingLines(indices);
        setCurrentMatch(0);
        return indices;
    }, []);

    const scrollToLine = useCallback((lineIdx: number) => {
        virtualizer.scrollToIndex(lineIdx, { align: 'center' });
    }, [virtualizer]);

    const handleSearch = () => {
        const indices = runSearch(searchQuery, useRegex, content);
        if (indices && indices.length > 0) {
            scrollToLine(indices[0]);
        }
    };

    const goToMatch = (delta: number) => {
        if (matchingLines.length === 0) return;
        const next = (currentMatch + delta + matchingLines.length) % matchingLines.length;
        setCurrentMatch(next);
        scrollToLine(matchingLines[next]);
    };

    const clearSearch = () => {
        setSearchQuery('');
        setMatchingLines([]);
        setCurrentMatch(0);
        setActiveRegex(null);
        setRegexError(false);
        searchInputRef.current?.focus();
    };

    const onSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (matchingLines.length > 0) {
                goToMatch(1);
            } else {
                handleSearch();
            }
        }
    };

    // ── Context menu (Ask AI) ──

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        if (!askGeminiCommands.length) return;
        const selection = window.getSelection()?.toString() ?? '';
        if (!selection) return;
        e.preventDefault();
        electronService.showContextMenu(selection, askGeminiCommands, false);
    }, [askGeminiCommands]);

    // ── Render ──

    const filteredFiles = fileFilter
        ? files.filter(f => f.name.toLowerCase().includes(fileFilter.toLowerCase()))
        : files;

    const virtualItems = virtualizer.getVirtualItems();

    return (
        <div className="log-viewer-pane">
            {/* Top header */}
            <div className="log-viewer-header">
                <span className="log-viewer-title">Log Viewer</span>
                <span className="log-viewer-path" title={loggingPath}>{loggingPath || '(not configured)'}</span>
            </div>

            <div className="log-viewer-body">
                {/* Left: file list sidebar (collapsible) */}
                <div className={`log-viewer-sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
                    {!sidebarCollapsed && (
                        <>
                            <div className="log-viewer-filter">
                                <input
                                    type="text"
                                    placeholder="Filter files..."
                                    value={fileFilter}
                                    onChange={e => setFileFilter(e.target.value)}
                                />
                                <button className="log-viewer-refresh-btn" onClick={loadFiles} title="Refresh file list">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="23 4 23 10 17 10"></polyline>
                                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                                    </svg>
                                    Refresh
                                </button>
                            </div>
                            {listError ? (
                                <div className="log-viewer-error">{listError}</div>
                            ) : filteredFiles.length === 0 ? (
                                <div className="log-viewer-empty">No log files found.</div>
                            ) : (
                                <ul className="log-viewer-file-list">
                                    {filteredFiles.map(f => (
                                        <li
                                            key={f.path}
                                            className={`log-viewer-file-item${selectedFile?.path === f.path ? ' selected' : ''}`}
                                            onClick={() => handleSelectFile(f)}
                                            title={f.path}
                                        >
                                            <span className="log-viewer-file-name">{f.name}</span>
                                            <span className="log-viewer-file-meta">
                                                {formatDate(f.mtime)} &middot; {formatSize(f.size)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </div>

                {/* Sidebar collapse tab */}
                <button
                    className="log-viewer-sidebar-toggle"
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                    title={sidebarCollapsed ? 'Expand file list' : 'Collapse file list'}
                >
                    {sidebarCollapsed ? '›' : '‹'}
                </button>

                {/* Right: content */}
                <div className="log-viewer-content">
                    {!selectedFile ? (
                        <div className="log-viewer-empty-content">Select a file to view its content.</div>
                    ) : loading ? (
                        <div className="log-viewer-empty-content">Loading...</div>
                    ) : contentError ? (
                        <div className="log-viewer-error">{contentError}</div>
                    ) : (
                        <>
                            {/* File info bar */}
                            <div className="log-viewer-content-header">
                                <span>{selectedFile.name}</span>
                                <div className="log-viewer-content-header-right">
                                    {hasTimestamps && (
                                        <label className="log-viewer-ts-toggle" title="Show/hide timestamps">
                                            <input
                                                type="checkbox"
                                                checked={showTimestamps}
                                                onChange={e => setShowTimestamps(e.target.checked)}
                                            />
                                            <span>Timestamps</span>
                                        </label>
                                    )}
                                    <span className="log-viewer-file-meta">{formatSize(selectedFile.size)} &middot; {lines.length} lines</span>
                                </div>
                            </div>

                            {/* Search bar */}
                            <div className="log-viewer-search-bar">
                                <div className={`log-viewer-search-input-wrap${regexError ? ' error' : ''}`}>
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        className="log-viewer-search-input"
                                        placeholder="Search…"
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        onKeyDown={onSearchKeyDown}
                                        title={regexError ? 'Invalid regular expression' : ''}
                                    />
                                    {searchQuery && (
                                        <button className="log-viewer-search-clear" onClick={clearSearch} title="Clear search">✕</button>
                                    )}
                                </div>
                                <label className="log-viewer-regex-toggle" title="Use regular expression">
                                    <input
                                        type="checkbox"
                                        checked={useRegex}
                                        onChange={e => setUseRegex(e.target.checked)}
                                    />
                                    <span>.*</span>
                                </label>
                                <button
                                    className="log-viewer-nav-btn"
                                    onClick={() => goToMatch(-1)}
                                    disabled={matchingLines.length === 0}
                                    title="Previous match"
                                >&#8679;</button>
                                <button
                                    className="log-viewer-nav-btn"
                                    onClick={() => goToMatch(1)}
                                    disabled={matchingLines.length === 0}
                                    title="Next match"
                                >&#8681;</button>
                                <button
                                    className="log-viewer-search-btn"
                                    onClick={() => selectedFile && handleSelectFile(selectedFile)}
                                    title="Reload file"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="23 4 23 10 17 10"></polyline>
                                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                                    </svg>
                                    Refresh
                                </button>
                                <button
                                    className="log-viewer-search-btn"
                                    onClick={handleSearch}
                                    disabled={!searchQuery}
                                    title="Search"
                                >Search</button>
                                {matchingLines.length > 0 && (
                                    <span className="log-viewer-match-count">
                                        {currentMatch + 1} / {matchingLines.length}
                                    </span>
                                )}
                                {searchQuery && matchingLines.length === 0 && !regexError && activeRegex && (
                                    <span className="log-viewer-match-count no-match">No matches</span>
                                )}
                                {regexError && (
                                    <span className="log-viewer-match-count no-match">Invalid regex</span>
                                )}
                            </div>

                            {/* Virtual scroll container */}
                            <div ref={scrollContainerRef} className="log-viewer-content-lines" onContextMenu={handleContextMenu}>
                                <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                                    {virtualItems.map(virtualRow => {
                                        const idx = virtualRow.index;
                                        const line = lines[idx];
                                        const isMatch = !!(activeRegex && matchingSet.has(idx));
                                        const isCurrent = isMatch && matchingLines[currentMatch] === idx;
                                        const ts = (hasTimestamps && showTimestamps) ? (timestamps![idx] ?? '') : null;
                                        return (
                                            <div
                                                key={idx}
                                                data-index={idx}
                                                ref={virtualizer.measureElement}
                                                style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    transform: `translateY(${virtualRow.start}px)`,
                                                    width: '100%',
                                                }}
                                                className={`log-line${isMatch ? ' log-line-match' : ''}${isCurrent ? ' log-line-current' : ''}`}
                                            >
                                                {ts !== null && (
                                                    <span className="log-line-timestamp">{ts}</span>
                                                )}
                                                <span className="log-line-text">
                                                    {isMatch && activeRegex ? highlightLine(line, activeRegex) : (line || '\u00A0')}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
