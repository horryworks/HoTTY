import { useCallback, useEffect, useRef, useState } from 'react';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import type { LogFile } from '../../types/appTypes';
import './LogViewerPane.css';

interface LogViewerPaneProps {
  paneId: string;
  active: boolean;
}

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
  const loggingPath = useSettingsStore((s) => s.loggingPath);
  const [folderPath, setFolderPath] = useState(loggingPath);
  const [folderInput, setFolderInput] = useState(loggingPath);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<LogFile | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadFiles = useCallback(async (path: string) => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const result = await tauriService.listLogFiles(path);
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

  return (
    <div className={`log-viewer-pane${active ? ' active' : ''}`} data-pane-id={paneId}>
      <div className="log-viewer-toolbar">
        <input
          type="text"
          className="log-viewer-folder-input"
          placeholder="Log folder path..."
          value={folderInput}
          onChange={(e) => setFolderInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="log-viewer-toolbar-btn"
          onClick={handleOpenFolder}
          disabled={!folderInput.trim()}
          title="Open folder"
        >
          Open
        </button>
        <button
          type="button"
          className="log-viewer-toolbar-btn"
          onClick={handleRefresh}
          disabled={!folderPath}
          title="Refresh file list"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <label className="log-viewer-auto-refresh">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto
        </label>
      </div>
      {error && <div className="log-viewer-error">{error}</div>}
      <div className="log-viewer-content">
        <div className="log-viewer-file-list">
          {files.length === 0 && folderPath && !loading && (
            <div className="log-viewer-empty">No log files found</div>
          )}
          {files.map((file) => (
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
        <div className="log-viewer-file-content">
          {loading && <div className="log-viewer-loading">Loading...</div>}
          {!loading && selectedFile && (
            <pre className="log-viewer-pre">{content}</pre>
          )}
          {!loading && !selectedFile && folderPath && (
            <div className="log-viewer-placeholder">Select a file to view</div>
          )}
          {!loading && !folderPath && (
            <div className="log-viewer-placeholder">Enter a folder path to browse log files</div>
          )}
        </div>
      </div>
    </div>
  );
}
