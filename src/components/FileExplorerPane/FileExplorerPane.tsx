import { useCallback, useEffect, useRef, useState } from 'react';
import { tauriService } from '../../services/tauriService';
import type { DirEntry } from '../../types/appTypes';
import './FileExplorerPane.css';

interface FileExplorerPaneProps {
  paneId: string;
  active: boolean;
  onOpenFileInEditor?: (filePath: string) => void;
}

type SortKey = 'name' | 'size' | 'mtime';

function formatSize(bytes: number): string {
  if (bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(mtime: number): string {
  if (!mtime) return '';
  return new Date(mtime).toLocaleString();
}

function pathSegments(path: string): { label: string; path: string }[] {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);

  // Handle Windows drive root like C:
  if (parts.length > 0 && parts[0].endsWith(':')) {
    const segments: { label: string; path: string }[] = [];
    let current = parts[0] + '/';
    segments.push({ label: parts[0] + '/', path: current });
    for (let i = 1; i < parts.length; i++) {
      current += parts[i] + '/';
      segments.push({ label: parts[i], path: current.slice(0, -1) });
    }
    return segments;
  }

  // Unix paths
  const segments: { label: string; path: string }[] = [{ label: '/', path: '/' }];
  let current = '';
  for (const part of parts) {
    current += '/' + part;
    segments.push({ label: part, path: current });
  }
  return segments;
}

function parentPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) {
    // At root or drive root
    if (normalized.length <= 3 && normalized.includes(':')) return null; // C:/ already
    return normalized === '/' ? null : '/';
  }
  const parent = normalized.slice(0, lastSlash);
  // Don't go above drive root on Windows
  if (parent.endsWith(':')) return parent + '/';
  return parent;
}

export function FileExplorerPane({ paneId, active, onOpenFileInEditor }: FileExplorerPaneProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const initialized = useRef(false);

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await tauriService.fileExplorerListDirectory(path);
      if (result.error) {
        setError(result.error);
        setEntries([]);
      } else {
        setEntries(result.entries ?? []);
        setCurrentPath(path);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initialize with drives and home directory
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      try {
        const result = await tauriService.fileExplorerGetDrives();
        setDrives(result.drives);
        if (result.homedir) {
          loadDirectory(result.homedir);
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [loadDirectory]);

  const handleNavigate = useCallback((path: string) => {
    loadDirectory(path);
  }, [loadDirectory]);

  const handleUp = useCallback(() => {
    const parent = parentPath(currentPath);
    if (parent) loadDirectory(parent);
  }, [currentPath, loadDirectory]);

  const handleDoubleClick = useCallback((entry: DirEntry) => {
    if (entry.isDirectory) {
      const sep = currentPath.includes('\\') ? '\\' : '/';
      const newPath = currentPath.replace(/[\\/]+$/, '') + sep + entry.name;
      loadDirectory(newPath);
    } else if (onOpenFileInEditor) {
      const sep = currentPath.includes('\\') ? '\\' : '/';
      const filePath = currentPath.replace(/[\\/]+$/, '') + sep + entry.name;
      onOpenFileInEditor(filePath);
    }
  }, [currentPath, loadDirectory, onOpenFileInEditor]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }, [sortKey]);

  // Filter and sort entries
  const filteredEntries = showHidden ? entries : entries.filter((e) => !e.isHidden);

  const sortedEntries = [...filteredEntries].sort((a, b) => {
    // Directories first
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;

    let cmp = 0;
    if (sortKey === 'name') {
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    } else if (sortKey === 'size') {
      cmp = a.size - b.size;
    } else {
      cmp = a.mtime - b.mtime;
    }
    return sortAsc ? cmp : -cmp;
  });

  const segments = currentPath ? pathSegments(currentPath) : [];
  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortAsc ? ' \u25B2' : ' \u25BC';
  };

  return (
    <div className={`file-explorer-pane${active ? ' active' : ''}`} data-pane-id={paneId}>
      <div className="file-explorer-toolbar">
        <button
          type="button"
          className="file-explorer-toolbar-btn"
          onClick={handleUp}
          disabled={!parentPath(currentPath)}
          title="Go up"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="file-explorer-breadcrumb">
          {segments.map((seg, i) => (
            <span key={seg.path}>
              {i > 0 && <span className="file-explorer-breadcrumb-sep">/</span>}
              <span
                className="file-explorer-breadcrumb-item"
                onClick={() => handleNavigate(seg.path)}
              >
                {seg.label}
              </span>
            </span>
          ))}
        </div>
        {drives.length > 1 && (
          <select
            className="file-explorer-drive-select"
            value=""
            onChange={(e) => { if (e.target.value) handleNavigate(e.target.value); }}
            title="Switch drive"
          >
            <option value="">Drive</option>
            {drives.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="file-explorer-toolbar-btn"
          onClick={() => loadDirectory(currentPath)}
          disabled={!currentPath}
          title="Refresh"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <label className="file-explorer-hidden-toggle">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Hidden
        </label>
      </div>
      {error && <div className="file-explorer-error">{error}</div>}
      <div className="file-explorer-table-wrapper">
        {loading ? (
          <div className="file-explorer-loading">Loading...</div>
        ) : (
          <table className="file-explorer-table">
            <thead>
              <tr>
                <th className="file-explorer-th-name" onClick={() => handleSort('name')}>
                  Name{sortIndicator('name')}
                </th>
                <th className="file-explorer-th-size" onClick={() => handleSort('size')}>
                  Size{sortIndicator('size')}
                </th>
                <th className="file-explorer-th-mtime" onClick={() => handleSort('mtime')}>
                  Modified{sortIndicator('mtime')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((entry) => (
                <tr
                  key={entry.name}
                  className={`file-explorer-row${entry.isDirectory ? ' directory' : ''}`}
                  onDoubleClick={() => handleDoubleClick(entry)}
                >
                  <td className="file-explorer-td-name">
                    <span className="file-explorer-icon">
                      {entry.isDirectory ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      )}
                    </span>
                    {entry.name}
                  </td>
                  <td className="file-explorer-td-size">{formatSize(entry.size)}</td>
                  <td className="file-explorer-td-mtime">{formatDate(entry.mtime)}</td>
                </tr>
              ))}
              {sortedEntries.length === 0 && (
                <tr>
                  <td colSpan={3} className="file-explorer-empty">
                    {showHidden ? 'Empty directory' : 'No visible files'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
