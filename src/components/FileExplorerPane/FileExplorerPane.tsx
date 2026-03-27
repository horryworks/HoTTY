import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as electronService from '../../services/electronService';
import './FileExplorerPane.css';

// -- Types --

interface DirectoryEntry {
    name: string;
    isDirectory: boolean;
    size: number;
    mtime: number;
    isHidden: boolean;
}

interface FlatNode {
    path: string;
    name: string;
    isDirectory: boolean;
    depth: number;
    size: number;
    isHidden: boolean;
    isExpanded: boolean;
    isLoading: boolean;
    error?: string;
}

interface FileExplorerPaneProps {
    sessionId: string;
    initialState?: {
        currentPath: string;
        expandedPaths: string[];
    };
    onStateChange?: (newState: Partial<{ currentPath: string; expandedPaths: string[] }>) => void;
    onOpenFile?: (filePath: string) => void;
}

// -- Helpers --

const PATH_SEP = '\\';

function joinPath(parent: string, child: string): string {
    if (parent.endsWith('\\') || parent.endsWith('/')) return parent + child;
    return parent + PATH_SEP + child;
}

function getPathSegments(path: string): { name: string; path: string }[] {
    if (!path) return [];
    const parts = path.replace(/\//g, '\\').split('\\').filter(Boolean);
    const segments: { name: string; path: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
        const segPath = parts.slice(0, i + 1).join('\\');
        // Add trailing backslash for Windows drive letters (e.g. "C:" → "C:\")
        const fullPath = /^[A-Za-z]:$/.test(segPath) ? segPath + '\\' : segPath;
        segments.push({ name: parts[i], path: fullPath });
    }
    return segments;
}

// -- Component --

export const FileExplorerPane: React.FC<FileExplorerPaneProps> = ({
    sessionId,
    initialState,
    onStateChange,
    onOpenFile,
}) => {
    const [drives, setDrives] = useState<string[]>([]);
    const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
        return new Set(initialState?.expandedPaths ?? []);
    });
    const [dirContents, setDirContents] = useState<Map<string, DirectoryEntry[]>>(new Map());
    const [loading, setLoading] = useState<Set<string>>(new Set());
    const [errors, setErrors] = useState<Map<string, string>>(new Map());
    const [showHidden, setShowHidden] = useState(false);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);

    const listRef = useRef<HTMLDivElement>(null);

    // Persist state changes
    const syncState = useCallback((expanded: Set<string>) => {
        onStateChange?.({
            expandedPaths: Array.from(expanded),
        });
    }, [onStateChange]);

    // Load drives on mount
    useEffect(() => {
        electronService.fileExplorerGetDrives().then(async (result) => {
            setDrives(result.drives);

            if (initialState?.expandedPaths?.length) {
                // Restore previously expanded paths
                for (const path of initialState.expandedPaths) {
                    loadDirectory(path);
                }
            } else if (result.homedir) {
                // First open: expand to home directory
                const homedir = result.homedir;
                // Build path segments to expand (e.g. C:\, C:\Users, C:\Users\horry)
                const parts = homedir.replace(/\//g, '\\').split('\\').filter(Boolean);
                const pathsToExpand: string[] = [];
                for (let i = 0; i < parts.length; i++) {
                    const seg = parts.slice(0, i + 1).join('\\');
                    const fullPath = /^[A-Za-z]:$/.test(seg) ? seg + '\\' : seg;
                    pathsToExpand.push(fullPath);
                }
                // Load and expand each segment sequentially
                const newExpanded = new Set<string>();
                for (const p of pathsToExpand) {
                    newExpanded.add(p);
                    await loadDirectoryAsync(p);
                }
                setExpandedDirs(newExpanded);
                setSelectedPath(homedir);
                syncState(newExpanded);
            }
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Async version for sequential loading (e.g. during init)
    const loadDirectoryAsync = useCallback(async (dirPath: string) => {
        setLoading(prev => new Set(prev).add(dirPath));
        setErrors(prev => {
            const next = new Map(prev);
            next.delete(dirPath);
            return next;
        });
        try {
            const result = await electronService.fileExplorerListDirectory(dirPath);
            if (result.error) {
                setErrors(prev => new Map(prev).set(dirPath, result.error!));
            } else if (result.entries) {
                setDirContents(prev => new Map(prev).set(dirPath, result.entries!));
            }
        } catch (err) {
            setErrors(prev => new Map(prev).set(dirPath, String(err)));
        } finally {
            setLoading(prev => {
                const next = new Set(prev);
                next.delete(dirPath);
                return next;
            });
        }
    }, []);

    const loadDirectory = useCallback(async (dirPath: string) => {
        if (loading.has(dirPath)) return;
        await loadDirectoryAsync(dirPath);
    }, [loading, loadDirectoryAsync]);

    const toggleExpand = useCallback((dirPath: string) => {
        setExpandedDirs(prev => {
            const next = new Set(prev);
            if (next.has(dirPath)) {
                next.delete(dirPath);
            } else {
                next.add(dirPath);
                // Load directory if not cached
                if (!dirContents.has(dirPath)) {
                    loadDirectory(dirPath);
                }
            }
            syncState(next);
            return next;
        });
    }, [dirContents, loadDirectory, syncState]);

    const handleRefresh = useCallback((dirPath?: string) => {
        if (dirPath) {
            // Refresh a specific directory
            loadDirectory(dirPath);
        } else {
            // Refresh all expanded directories
            electronService.fileExplorerGetDrives().then(result => setDrives(result.drives));
            for (const path of expandedDirs) {
                loadDirectory(path);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expandedDirs]);

    const handleDoubleClick = useCallback((path: string, isDirectory: boolean) => {
        if (isDirectory) {
            toggleExpand(path);
        } else {
            onOpenFile?.(path);
        }
    }, [toggleExpand, onOpenFile]);

    // Flatten tree into virtual list
    const flatNodes = useMemo(() => {
        const nodes: FlatNode[] = [];

        const addEntries = (parentPath: string, depth: number) => {
            const entries = dirContents.get(parentPath);
            if (!entries) return;
            for (const entry of entries) {
                if (!showHidden && entry.isHidden) continue;
                const fullPath = joinPath(parentPath, entry.name);
                const isExpanded = expandedDirs.has(fullPath);
                const isLoading = loading.has(fullPath);
                const error = errors.get(fullPath);
                nodes.push({
                    path: fullPath,
                    name: entry.name,
                    isDirectory: entry.isDirectory,
                    depth,
                    size: entry.size,
                    isHidden: entry.isHidden,
                    isExpanded,
                    isLoading,
                    error,
                });
                if (entry.isDirectory && isExpanded) {
                    addEntries(fullPath, depth + 1);
                }
            }
        };

        // Add drives as roots
        for (const drive of drives) {
            const isExpanded = expandedDirs.has(drive);
            const isLoading = loading.has(drive);
            const error = errors.get(drive);
            nodes.push({
                path: drive,
                name: drive,
                isDirectory: true,
                depth: 0,
                size: 0,
                isHidden: false,
                isExpanded,
                isLoading,
                error,
            });
            if (isExpanded) {
                addEntries(drive, 1);
            }
        }

        return nodes;
    }, [drives, expandedDirs, dirContents, loading, errors, showHidden]);

    // Virtual scroller
    const virtualizer = useVirtualizer({
        count: flatNodes.length,
        getScrollElement: () => listRef.current,
        estimateSize: () => 24,
        overscan: 20,
    });

    // Breadcrumb from selected path
    const breadcrumbSegments = useMemo(() => {
        if (!selectedPath) return [];
        return getPathSegments(selectedPath);
    }, [selectedPath]);

    const handleBreadcrumbClick = useCallback((segPath: string) => {
        // Expand to this path
        if (!expandedDirs.has(segPath)) {
            toggleExpand(segPath);
        }
        setSelectedPath(segPath);
    }, [expandedDirs, toggleExpand]);

    return (
        <div className="file-explorer" data-session-id={sessionId}>
            {/* Toolbar */}
            <div className="file-explorer-toolbar">
                {/* Refresh */}
                <button
                    className="file-explorer-toolbar-btn"
                    title="Refresh"
                    onClick={() => handleRefresh()}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                </button>

                {/* Toggle hidden */}
                <button
                    className={`file-explorer-toolbar-btn ${showHidden ? 'active' : ''}`}
                    title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
                    onClick={() => setShowHidden(v => !v)}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {showHidden ? (
                            <>
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                            </>
                        ) : (
                            <>
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                <line x1="1" y1="1" x2="23" y2="23" />
                            </>
                        )}
                    </svg>
                </button>

                {/* Breadcrumb */}
                <div className="file-explorer-breadcrumb">
                    {breadcrumbSegments.length > 0 ? (
                        breadcrumbSegments.map((seg, i) => (
                            <React.Fragment key={seg.path}>
                                {i > 0 && <span className="file-explorer-breadcrumb-separator">&gt;</span>}
                                <span
                                    className="file-explorer-breadcrumb-segment"
                                    onClick={() => handleBreadcrumbClick(seg.path)}
                                >
                                    {seg.name}
                                </span>
                            </React.Fragment>
                        ))
                    ) : null}
                </div>
            </div>

            {/* Tree list */}
            <div className="file-explorer-list">
                <div ref={listRef} className="file-explorer-list-content">
                    {flatNodes.length === 0 ? (
                        <div className="file-explorer-empty">
                            {drives.length === 0 ? 'Loading drives...' : 'No files to display'}
                        </div>
                    ) : (
                        <div
                            style={{
                                height: `${virtualizer.getTotalSize()}px`,
                                width: '100%',
                                position: 'relative',
                            }}
                        >
                            {virtualizer.getVirtualItems().map(virtualRow => {
                                const node = flatNodes[virtualRow.index];
                                return (
                                    <div
                                        key={node.path}
                                        className={`file-explorer-row ${selectedPath === node.path ? 'selected' : ''} ${node.isHidden ? 'hidden-entry' : ''}`}
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: `${virtualRow.size}px`,
                                            transform: `translateY(${virtualRow.start}px)`,
                                        }}
                                        onClick={() => {
                                            setSelectedPath(node.path);
                                            if (node.isDirectory) {
                                                toggleExpand(node.path);
                                            }
                                        }}
                                        onDoubleClick={() => handleDoubleClick(node.path, node.isDirectory)}
                                    >
                                        {/* Indent */}
                                        <span
                                            className="file-explorer-row-indent"
                                            style={{ width: `${node.depth * 16}px` }}
                                        />

                                        {/* Chevron for directories */}
                                        {node.isDirectory ? (
                                            <span className={`file-explorer-row-chevron ${node.isExpanded ? 'expanded' : ''}`}>
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M8 5l8 7-8 7z" />
                                                </svg>
                                            </span>
                                        ) : (
                                            <span className="file-explorer-row-chevron" />
                                        )}

                                        {/* Icon */}
                                        <span className="file-explorer-row-icon">
                                            {node.isDirectory ? (
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-folder)' }}>
                                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                                </svg>
                                            ) : (
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                    <polyline points="14 2 14 8 20 8" />
                                                </svg>
                                            )}
                                        </span>

                                        {/* Name */}
                                        <span className="file-explorer-row-name">{node.name}</span>

                                        {/* Loading indicator */}
                                        {node.isLoading && (
                                            <span className="file-explorer-loading">
                                                <span className="file-explorer-spinner" />
                                            </span>
                                        )}

                                        {/* Error indicator */}
                                        {node.error && (
                                            <span className="file-explorer-error" title={node.error}>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <circle cx="12" cy="12" r="10" />
                                                    <line x1="15" y1="9" x2="9" y2="15" />
                                                    <line x1="9" y1="9" x2="15" y2="15" />
                                                </svg>
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
