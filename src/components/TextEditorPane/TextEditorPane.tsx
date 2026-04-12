import { useCallback, useEffect, useRef, useState } from 'react';
import { tauriService } from '../../services/tauriService';
import './TextEditorPane.css';

interface TextEditorPaneProps {
  paneId: string;
  active: boolean;
  initialFilePath?: string;
  onDisplayNameChange?: (name: string) => void;
}

const ENCODINGS = ['utf-8', 'shift_jis', 'euc-jp'] as const;

function filenameFromPath(path: string): string {
  const sep = path.includes('\\') ? '\\' : '/';
  return path.split(sep).pop() || path;
}

export function TextEditorPane({
  paneId,
  active,
  initialFilePath,
  onDisplayNameChange,
}: TextEditorPaneProps) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [encoding, setEncoding] = useState<string>('utf-8');
  const [lineEnding, setLineEnding] = useState('LF');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialLoaded = useRef(false);

  const isDirty = content !== originalContent;

  const loadFile = useCallback(async (path: string, enc: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await tauriService.textEditorReadFile(path, enc);
      setContent(result.content);
      setOriginalContent(result.content);
      setLineEnding(result.lineEnding);
      setFilePath(path);
      onDisplayNameChange?.(filenameFromPath(path));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [onDisplayNameChange]);

  // Load initial file if provided
  useEffect(() => {
    if (initialFilePath && !initialLoaded.current) {
      initialLoaded.current = true;
      loadFile(initialFilePath, encoding);
    }
  }, [initialFilePath, encoding, loadFile]);

  const handleOpen = useCallback(async () => {
    setError(null);
    try {
      const path = await tauriService.textEditorOpenFile();
      if (path) {
        await loadFile(path, encoding);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [encoding, loadFile]);

  const handleSaveAs = useCallback(async () => {
    setError(null);
    try {
      const path = await tauriService.textEditorSaveFile(filePath ?? undefined);
      if (path) {
        await tauriService.textEditorWriteFile(path, content, encoding);
        setFilePath(path);
        setOriginalContent(content);
        onDisplayNameChange?.(filenameFromPath(path));
      }
    } catch (e) {
      setError(String(e));
    }
  }, [filePath, content, encoding, onDisplayNameChange]);

  const handleSave = useCallback(async () => {
    if (!filePath) {
      handleSaveAs();
      return;
    }
    setError(null);
    try {
      await tauriService.textEditorWriteFile(filePath, content, encoding);
      setOriginalContent(content);
    } catch (e) {
      setError(String(e));
    }
  }, [filePath, content, encoding, handleSaveAs]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        handleSave();
      } else if (k === 'o') {
        e.preventDefault();
        handleOpen();
      }
    }
  }, [handleSave, handleOpen]);

  const displayName = filePath ? filenameFromPath(filePath) : 'Untitled';

  return (
    <div
      className={`text-editor-pane${active ? ' active' : ''}`}
      data-pane-id={paneId}
      ref={containerRef}
      onKeyDown={handleKeyDown}
    >
      <div className="text-editor-toolbar">
        <span className="text-editor-filename">
          {isDirty && <span className="text-editor-dirty" title="Unsaved changes" />}
          {displayName}
        </span>
        <button type="button" className="text-editor-toolbar-btn" onClick={handleOpen} title="Open file (Ctrl+O)">
          Open
        </button>
        <button type="button" className="text-editor-toolbar-btn" onClick={handleSave} title="Save (Ctrl+S)">
          Save
        </button>
        <button type="button" className="text-editor-toolbar-btn" onClick={handleSaveAs} title="Save As">
          Save As
        </button>
        <select
          className="text-editor-encoding"
          value={encoding}
          onChange={(e) => setEncoding(e.target.value)}
          title="Encoding"
        >
          {ENCODINGS.map((enc) => (
            <option key={enc} value={enc}>{enc}</option>
          ))}
        </select>
        <span className="text-editor-line-ending" title="Line ending">{lineEnding}</span>
      </div>
      {error && <div className="text-editor-error">{error}</div>}
      {loading ? (
        <div className="text-editor-loading">Loading...</div>
      ) : (
        <textarea
          className="text-editor-area"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          wrap="off"
          placeholder="Open a file or start typing..."
        />
      )}
    </div>
  );
}
