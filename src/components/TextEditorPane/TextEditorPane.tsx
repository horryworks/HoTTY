import { useCallback, useEffect, useRef, useState } from 'react';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import type { TextEditorTab } from '../../types/appTypes';
import { SaveConfirmModal } from '../SaveConfirmModal/SaveConfirmModal';
import { setEditorDirtyCount, clearEditorDirty } from '../../utils/dirtyEditors';
import { logError } from '../../utils/logger';
import { normalizeLineEnding } from '../../utils/lineEndings';
import './TextEditorPane.css';

interface TextEditorPaneProps {
  paneId: string;
  active: boolean;
  initialFilePath?: string;
  onDisplayNameChange?: (name: string) => void;
  onOpenFile?: (filePath: string) => void;
}

interface TextEditorPaneHandle {
  openFile: (filePath: string) => void;
}

const ENCODINGS = ['utf-8', 'shift_jis', 'euc-jp'] as const;
const LINE_ENDINGS = ['CRLF', 'LF'] as const;

function filenameFromPath(path: string): string {
  const sep = path.includes('\\') ? '\\' : '/';
  return path.split(sep).pop() || path;
}

function makeTab(overrides?: Partial<TextEditorTab>): TextEditorTab {
  return {
    id: crypto.randomUUID(),
    filePath: null,
    content: '',
    savedContent: '',
    encoding: 'utf-8',
    lineEnding: 'CRLF',
    ...overrides,
  };
}

export function TextEditorPane({
  paneId,
  active,
  initialFilePath,
  onDisplayNameChange,
}: TextEditorPaneProps) {
  const [tabs, setTabs] = useState<TextEditorTab[]>(() => [makeTab()]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [openMenu, setOpenMenu] = useState<'file' | 'edit' | 'view' | null>(null);
  const [showFind, setShowFind] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showGoto, setShowGoto] = useState(false);
  const [gotoValue, setGotoValue] = useState('');
  const [showReturnCodes, setShowReturnCodes] = useState(false);
  const [showEncodingPicker, setShowEncodingPicker] = useState(false);
  const [showLineEndingPicker, setShowLineEndingPicker] = useState(false);
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);

  const lineWrapEnabled = useSettingsStore((s) => s.lineWrapEnabled);
  const updateSetting = useSettingsStore((s) => s.update);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const subtabListRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const gotoInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialLoaded = useRef(false);
  const measurerRef = useRef<HTMLDivElement | null>(null);
  const [visualLineNumbers, setVisualLineNumbers] = useState<(number | '')[]>([1]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const isTabDirty = useCallback((tab: TextEditorTab) => {
    if (!tab.filePath && tab.content === '') return false;
    return tab.content !== tab.savedContent;
  }, []);

  useEffect(() => {
    const dirtyCount = tabs.filter(isTabDirty).length;
    setEditorDirtyCount(paneId, dirtyCount);
    return () => {
      clearEditorDirty(paneId);
    };
  }, [tabs, isTabDirty, paneId]);

  // Update a single tab's data
  const updateTab = useCallback((tabId: string, updates: Partial<TextEditorTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t)));
  }, []);

  // Update display name based on active tab
  const syncDisplayName = useCallback(
    (tab: TextEditorTab) => {
      const name = tab.filePath ? filenameFromPath(tab.filePath) : 'Text Editor';
      onDisplayNameChange?.(name);
    },
    [onDisplayNameChange],
  );

  // Load a file into a tab
  const loadFileIntoTab = useCallback(
    async (tabId: string, path: string, encoding: string) => {
      try {
        const result = await tauriService.textEditorReadFile(path, encoding);
        updateTab(tabId, {
          filePath: path,
          content: result.content,
          savedContent: result.content,
          lineEnding: result.lineEnding as 'LF' | 'CRLF',
        });
        return true;
      } catch (err) {
        logError('TextEditor', 'Failed to load file', err);
        return false;
      }
    },
    [updateTab],
  );

  // Open a file (create new tab or reuse empty tab)
  const openFileInTab = useCallback(
    async (filePath: string) => {
      // Check if already open
      const existing = tabs.find((t) => t.filePath === filePath);
      if (existing) {
        setActiveTabId(existing.id);
        syncDisplayName(existing);
        return;
      }

      // Reuse active empty untitled tab
      const emptyTab = tabs.find((t) => t.id === activeTabId && !t.filePath && !t.content);
      if (emptyTab) {
        await loadFileIntoTab(emptyTab.id, filePath, emptyTab.encoding);
        syncDisplayName({ ...emptyTab, filePath });
      } else {
        const newTab = makeTab();
        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(newTab.id);
        await loadFileIntoTab(newTab.id, filePath, 'utf-8');
        syncDisplayName({ ...newTab, filePath });
      }
    },
    [tabs, activeTabId, loadFileIntoTab, syncDisplayName],
  );

  // Load initial file if provided
  useEffect(() => {
    if (!initialFilePath || initialLoaded.current) return;
    initialLoaded.current = true;
    const load = async () => {
      const existing = tabs.find((t) => t.filePath === initialFilePath);
      if (existing) return;
      const emptyTab = tabs.find((t) => !t.filePath && !t.content);
      if (emptyTab) {
        await loadFileIntoTab(emptyTab.id, initialFilePath, emptyTab.encoding);
        syncDisplayName({ ...emptyTab, filePath: initialFilePath });
      } else {
        const newTab = makeTab();
        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(newTab.id);
        await loadFileIntoTab(newTab.id, initialFilePath, 'utf-8');
        syncDisplayName({ ...newTab, filePath: initialFilePath });
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilePath]);

  // Expose openFile for external callers (App.tsx)
  const handleRef = useRef<TextEditorPaneHandle>({ openFile: openFileInTab });

  // Store handle on the DOM element for App.tsx to access
  useEffect(() => {
    handleRef.current.openFile = openFileInTab;
    const el = document.querySelector(`[data-pane-id="${paneId}"]`);
    if (el) {
      (el as HTMLElement & { __editorHandle?: TextEditorPaneHandle }).__editorHandle = handleRef.current;
    }
  }, [paneId, openFileInTab]);

  // Tab operations
  const addNewTab = useCallback(() => {
    const newTab = makeTab();
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    syncDisplayName(newTab);
  }, [syncDisplayName]);

  const forceCloseTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) {
          const resetTab = makeTab({ id: prev[0].id });
          setActiveTabId(resetTab.id);
          syncDisplayName(resetTab);
          return [resetTab];
        }
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);
        if (tabId === activeTabId) {
          const newIdx = Math.min(idx, next.length - 1);
          setActiveTabId(next[newIdx].id);
          syncDisplayName(next[newIdx]);
        }
        return next;
      });
    },
    [activeTabId, syncDisplayName],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab && isTabDirty(tab)) {
        setPendingCloseTabId(tabId);
        return;
      }
      forceCloseTab(tabId);
    },
    [tabs, isTabDirty, forceCloseTab],
  );

  // Save a specific tab (used by the unsaved-changes flow where the closing
  // tab may not be the active one). Returns true on success.
  // Normalize line endings, write to disk, and — only after a successful write —
  // record the saved content + path. Shared by saveTab / handleSave /
  // handleSaveAs so the line-ending rule and the "commit filePath only on
  // success" invariant live in exactly one place. Returns true on success.
  const writeTabToDisk = useCallback(
    async (tab: TextEditorTab, savePath: string): Promise<boolean> => {
      try {
        const saveContent = normalizeLineEnding(tab.content, tab.lineEnding);
        await tauriService.textEditorWriteFile(savePath, saveContent, tab.encoding);
        updateTab(tab.id, { savedContent: tab.content, filePath: savePath });
        return true;
      } catch (err) {
        logError('TextEditor', 'Failed to save file', err);
        return false;
      }
    },
    [updateTab],
  );

  const saveTab = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return false;
      let savePath = tab.filePath;
      if (!savePath) {
        savePath = await tauriService.textEditorSaveFile();
        if (!savePath) return false;
      }
      const ok = await writeTabToDisk(tab, savePath);
      if (ok && tabId === activeTabId) {
        syncDisplayName({ ...tab, filePath: savePath });
      }
      return ok;
    },
    [tabs, activeTabId, writeTabToDisk, syncDisplayName],
  );

  const handleSaveConfirmSave = useCallback(async () => {
    if (!pendingCloseTabId) return;
    const id = pendingCloseTabId;
    const ok = await saveTab(id);
    if (ok) {
      setPendingCloseTabId(null);
      forceCloseTab(id);
    }
    // If save was cancelled or failed, keep the modal open so the user can
    // choose Discard or Cancel explicitly.
  }, [pendingCloseTabId, saveTab, forceCloseTab]);

  const handleSaveConfirmDiscard = useCallback(() => {
    if (!pendingCloseTabId) return;
    const id = pendingCloseTabId;
    setPendingCloseTabId(null);
    forceCloseTab(id);
  }, [pendingCloseTabId, forceCloseTab]);

  const handleSaveConfirmCancel = useCallback(() => {
    setPendingCloseTabId(null);
  }, []);

  const pendingCloseTab = pendingCloseTabId
    ? tabs.find((t) => t.id === pendingCloseTabId)
    : null;

  const switchTab = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId);
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) syncDisplayName(tab);
      setCursorLine(1);
      setCursorCol(1);
    },
    [tabs, syncDisplayName],
  );

  // Sync scroll between line numbers, overlay, and textarea
  const handleTextareaScroll = useCallback(() => {
    if (textareaRef.current) {
      if (lineNumbersRef.current) {
        lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
      }
      if (overlayRef.current) {
        overlayRef.current.scrollTop = textareaRef.current.scrollTop;
        overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
      }
    }
  }, []);

  // Update cursor position
  const updateCursorPosition = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const textBefore = ta.value.substring(0, pos);
    const lines = textBefore.split('\n');
    setCursorLine(lines.length);
    setCursorCol(lines[lines.length - 1].length + 1);
  }, []);

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateTab(activeTabId, { content: e.target.value });
      updateCursorPosition();
    },
    [activeTabId, updateTab, updateCursorPosition],
  );

  // File operations
  const handleNew = useCallback(() => {
    addNewTab();
    setOpenMenu(null);
  }, [addNewTab]);

  const handleOpen = useCallback(async () => {
    setOpenMenu(null);
    const path = await tauriService.textEditorOpenFile();
    if (!path) return;
    await openFileInTab(path);
  }, [openFileInTab]);

  const handleSave = useCallback(async () => {
    setOpenMenu(null);
    let savePath = activeTab.filePath;
    if (!savePath) {
      savePath = await tauriService.textEditorSaveFile();
      if (!savePath) return;
    }
    const ok = await writeTabToDisk(activeTab, savePath);
    if (ok) syncDisplayName({ ...activeTab, filePath: savePath });
  }, [activeTab, writeTabToDisk, syncDisplayName]);

  const handleSaveAs = useCallback(async () => {
    setOpenMenu(null);
    const savePath = await tauriService.textEditorSaveFile(activeTab.filePath || undefined);
    if (!savePath) return;
    const ok = await writeTabToDisk(activeTab, savePath);
    if (ok) syncDisplayName({ ...activeTab, filePath: savePath });
  }, [activeTab, writeTabToDisk, syncDisplayName]);

  const handleCloseTab = useCallback(() => {
    setOpenMenu(null);
    closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  // Find operations
  const handleFindNext = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || !findText) return;
    const startPos = ta.selectionEnd;
    let idx = activeTab.content.indexOf(findText, startPos);
    if (idx === -1) {
      idx = activeTab.content.indexOf(findText);
    }
    if (idx !== -1) {
      ta.focus();
      ta.setSelectionRange(idx, idx + findText.length);
    }
  }, [activeTab.content, findText]);

  const handleReplaceCurrent = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || !findText) return;
    const selStart = ta.selectionStart;
    const selEnd = ta.selectionEnd;
    const selected = activeTab.content.substring(selStart, selEnd);
    if (selected === findText) {
      const newContent =
        activeTab.content.substring(0, selStart) + replaceText + activeTab.content.substring(selEnd);
      updateTab(activeTabId, { content: newContent });
      ta.focus();
      ta.setSelectionRange(selStart + replaceText.length, selStart + replaceText.length);
      handleFindNext();
    } else {
      handleFindNext();
    }
  }, [activeTab.content, activeTabId, findText, replaceText, updateTab, handleFindNext]);

  const handleReplaceAll = useCallback(() => {
    if (!findText) return;
    const newContent = activeTab.content.split(findText).join(replaceText);
    updateTab(activeTabId, { content: newContent });
  }, [activeTab.content, activeTabId, findText, replaceText, updateTab]);

  // GoTo line
  const handleGotoLine = useCallback(() => {
    const lineNum = parseInt(gotoValue, 10);
    if (isNaN(lineNum) || lineNum < 1) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const lines = activeTab.content.split('\n');
    const targetLine = Math.min(lineNum, lines.length);
    let pos = 0;
    for (let i = 0; i < targetLine - 1; i++) {
      pos += lines[i].length + 1;
    }
    ta.focus();
    ta.setSelectionRange(pos, pos);
    setShowGoto(false);
    setGotoValue('');
    updateCursorPosition();
  }, [gotoValue, activeTab.content, updateCursorPosition]);

  // Encoding / line ending change
  const handleEncodingChange = useCallback(
    async (newEncoding: string) => {
      setShowEncodingPicker(false);
      updateTab(activeTabId, { encoding: newEncoding });
      if (activeTab.filePath) {
        try {
          const result = await tauriService.textEditorReadFile(activeTab.filePath, newEncoding);
          updateTab(activeTabId, {
            encoding: newEncoding,
            content: result.content,
            savedContent: result.content,
          });
        } catch (err) {
          logError('TextEditor', 'Failed to re-read file with encoding', err);
        }
      }
    },
    [activeTab.filePath, activeTabId, updateTab],
  );

  const handleLineEndingChange = useCallback(
    (newLineEnding: 'LF' | 'CRLF') => {
      setShowLineEndingPicker(false);
      updateTab(activeTabId, { lineEnding: newLineEnding });
    },
    [activeTabId, updateTab],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const paneEl = document.querySelector(`[data-pane-id="${paneId}"]`);
      if (!paneEl?.contains(document.activeElement)) return;

      if (e.ctrlKey) {
        switch (e.key.toLowerCase()) {
          case 'o':
            e.preventDefault();
            handleOpen();
            break;
          case 's':
            e.preventDefault();
            if (e.shiftKey) handleSaveAs();
            else handleSave();
            break;
          case 'f':
            e.preventDefault();
            setShowFind(true);
            setShowReplace(false);
            setTimeout(() => findInputRef.current?.focus(), 0);
            break;
          case 'h':
            e.preventDefault();
            setShowFind(true);
            setShowReplace(true);
            setTimeout(() => findInputRef.current?.focus(), 0);
            break;
          case 'g':
            e.preventDefault();
            setShowGoto(true);
            setTimeout(() => gotoInputRef.current?.focus(), 0);
            break;
          case 'w':
            e.preventDefault();
            closeTab(activeTabId);
            break;
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [paneId, handleOpen, handleSave, handleSaveAs, closeTab, activeTabId]);

  // Close menus on click outside
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu]);

  // Close dropdowns on click outside
  useEffect(() => {
    if (!showEncodingPicker && !showLineEndingPicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.text-editor-status-item')) {
        setShowEncodingPicker(false);
        setShowLineEndingPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEncodingPicker, showLineEndingPicker]);

  // Auto-scroll active sub-tab into view
  useEffect(() => {
    const container = subtabListRef.current;
    if (!container) return;
    const activeEl = container.querySelector('.text-editor-subtab.active') as HTMLElement | null;
    activeEl?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  // Horizontal scroll on sub-tab bar with mouse wheel
  useEffect(() => {
    const container = subtabListRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  // Sub-tab middle-click close
  const handleSubTabMouseDown = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(tabId);
      }
    },
    [closeTab],
  );

  // Sub-tab drag reorder
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropAtEnd, setDropAtEnd] = useState(false);

  const handleTabDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    setDragTabId(tabId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-tab-id', tabId);
  }, []);

  const handleTabDragOver = useCallback(
    (e: React.DragEvent, tabId: string) => {
      if (!dragTabId || dragTabId === tabId) {
        setDropTargetId(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetId(tabId);
      setDropAtEnd(false);
    },
    [dragTabId],
  );

  const handleTabDrop = useCallback(
    (e: React.DragEvent, targetTabId: string) => {
      e.preventDefault();
      e.stopPropagation();
      if (!dragTabId || dragTabId === targetTabId) {
        setDragTabId(null);
        setDropTargetId(null);
        setDropAtEnd(false);
        return;
      }
      setTabs((prev) => {
        const fromIdx = prev.findIndex((t) => t.id === dragTabId);
        const toIdx = prev.findIndex((t) => t.id === targetTabId);
        if (fromIdx === -1 || toIdx === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
      setDragTabId(null);
      setDropTargetId(null);
      setDropAtEnd(false);
    },
    [dragTabId],
  );

  const handleTabDragEnd = useCallback(() => {
    setDragTabId(null);
    setDropTargetId(null);
    setDropAtEnd(false);
  }, []);

  const handleSubtabListDragOver = useCallback(
    (e: React.DragEvent) => {
      if (e.target !== e.currentTarget) return;
      if (!dragTabId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetId(null);
      setDropAtEnd(true);
    },
    [dragTabId],
  );

  const handleSubtabListDrop = useCallback(
    (e: React.DragEvent) => {
      if (e.target !== e.currentTarget) return;
      if (!dragTabId) return;
      e.preventDefault();
      setDropAtEnd(false);
      setTabs((prev) => {
        const fromIdx = prev.findIndex((t) => t.id === dragTabId);
        if (fromIdx === -1 || fromIdx === prev.length - 1) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.push(moved);
        return next;
      });
      setDragTabId(null);
      setDropTargetId(null);
    },
    [dragTabId],
  );

  // Compute visual line numbers, accounting for line wrap
  const computeVisualLineNumbers = useCallback(() => {
    const lines = activeTab.content.split('\n');
    if (!lineWrapEnabled) {
      setVisualLineNumbers(lines.map((_, i) => i + 1));
      return;
    }
    const ta = textareaRef.current;
    if (!ta) {
      setVisualLineNumbers(lines.map((_, i) => i + 1));
      return;
    }
    const style = window.getComputedStyle(ta);
    const lineHeightPx = parseFloat(style.lineHeight);
    const paddingLeft = parseFloat(style.paddingLeft);
    const paddingRight = parseFloat(style.paddingRight);
    const innerWidth = ta.clientWidth - paddingLeft - paddingRight;
    if (innerWidth <= 0 || !isFinite(lineHeightPx) || lineHeightPx <= 0) {
      setVisualLineNumbers(lines.map((_, i) => i + 1));
      return;
    }
    if (!measurerRef.current) {
      measurerRef.current = document.createElement('div');
      document.body.appendChild(measurerRef.current);
    }
    const measurer = measurerRef.current;
    measurer.style.cssText = [
      'position:fixed',
      'top:-9999px',
      'left:-9999px',
      'visibility:hidden',
      'pointer-events:none',
      `width:${innerWidth}px`,
      `font-family:${style.fontFamily}`,
      `font-size:${style.fontSize}`,
      `line-height:${style.lineHeight}`,
      'white-space:pre-wrap',
      'word-wrap:break-word',
      'tab-size:4',
      'padding:0',
      'margin:0',
      'border:none',
      'overflow:hidden',
    ].join(';');
    const spans = lines.map((line) => {
      const el = document.createElement('div');
      el.textContent = line || '\u200b';
      return el;
    });
    measurer.replaceChildren(...spans);
    const heights = spans.map((el) => el.offsetHeight);
    measurer.replaceChildren();
    const result: (number | '')[] = [];
    heights.forEach((height, i) => {
      const visualCount = Math.max(1, Math.round(height / lineHeightPx));
      result.push(i + 1);
      for (let j = 1; j < visualCount; j++) result.push('');
    });
    setVisualLineNumbers(result);
  }, [activeTab.content, lineWrapEnabled]);

  // Recompute visual line numbers on content or wrap change
  useEffect(() => {
    computeVisualLineNumbers();
  }, [computeVisualLineNumbers]);

  // Recompute on textarea resize (relevant when line wrap is on)
  useEffect(() => {
    if (!lineWrapEnabled) return;
    if (typeof ResizeObserver === 'undefined') return;
    const ta = textareaRef.current;
    if (!ta) return;
    const observer = new ResizeObserver(() => computeVisualLineNumbers());
    observer.observe(ta);
    return () => observer.disconnect();
  }, [lineWrapEnabled, computeVisualLineNumbers]);

  // Clean up measurer on unmount
  useEffect(() => {
    return () => {
      if (measurerRef.current) {
        document.body.removeChild(measurerRef.current);
        measurerRef.current = null;
      }
    };
  }, []);

  return (
    <div className={`text-editor-pane${active ? ' active' : ''}`} data-pane-id={paneId}>
      {/* Sub-tab bar */}
      <div className="text-editor-subtab-bar">
        <div
          className="text-editor-subtab-list"
          ref={subtabListRef}
          onDragOver={handleSubtabListDragOver}
          onDrop={handleSubtabListDrop}
        >
          {tabs.map((tab, tabIndex) => {
            const fileName = tab.filePath ? filenameFromPath(tab.filePath) : 'Untitled';
            const dirty = isTabDirty(tab);
            const isLastTab = tabIndex === tabs.length - 1;
            return (
              <div
                key={tab.id}
                className={`text-editor-subtab${tab.id === activeTabId ? ' active' : ''}${dragTabId === tab.id ? ' dragging' : ''}${dropTargetId === tab.id ? ' drop-target' : ''}${dropAtEnd && isLastTab ? ' drop-target-right' : ''}`}
                onClick={() => switchTab(tab.id)}
                onMouseDown={(e) => handleSubTabMouseDown(e, tab.id)}
                title={tab.filePath || 'Untitled'}
                draggable
                onDragStart={(e) => handleTabDragStart(e, tab.id)}
                onDragOver={(e) => handleTabDragOver(e, tab.id)}
                onDrop={(e) => handleTabDrop(e, tab.id)}
                onDragEnd={handleTabDragEnd}
              >
                <span className="text-editor-subtab-title">
                  {dirty && <span className="text-editor-subtab-dirty">{'\u25CF'} </span>}
                  {fileName}
                </span>
                <div
                  className="text-editor-subtab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-editor-subtab-new" onClick={addNewTab} title="New Tab">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
      </div>

      {/* Toolbar: menus + status */}
      <div className="text-editor-toolbar">
        <div className="text-editor-menus" ref={menuRef}>
          {/* File Menu */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className={`text-editor-menu-btn${openMenu === 'file' ? ' active' : ''}`}
              onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
            >
              File
            </button>
            {openMenu === 'file' && (
              <div className="text-editor-menu-dropdown">
                <div className="text-editor-menu-item" onClick={handleNew}>
                  <span>New Tab</span>
                  <span className="text-editor-menu-shortcut">Ctrl+N</span>
                </div>
                <div className="text-editor-menu-item" onClick={handleOpen}>
                  <span>Open...</span>
                  <span className="text-editor-menu-shortcut">Ctrl+O</span>
                </div>
                <div className="text-editor-menu-separator" />
                <div className="text-editor-menu-item" onClick={handleSave}>
                  <span>Save</span>
                  <span className="text-editor-menu-shortcut">Ctrl+S</span>
                </div>
                <div className="text-editor-menu-item" onClick={handleSaveAs}>
                  <span>Save As...</span>
                  <span className="text-editor-menu-shortcut">Ctrl+Shift+S</span>
                </div>
                <div className="text-editor-menu-separator" />
                <div className="text-editor-menu-item" onClick={handleCloseTab}>
                  <span>Close Tab</span>
                  <span className="text-editor-menu-shortcut">Ctrl+W</span>
                </div>
              </div>
            )}
          </div>
          {/* Edit Menu */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className={`text-editor-menu-btn${openMenu === 'edit' ? ' active' : ''}`}
              onClick={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')}
            >
              Edit
            </button>
            {openMenu === 'edit' && (
              <div className="text-editor-menu-dropdown">
                <div
                  className="text-editor-menu-item"
                  onClick={() => {
                    document.execCommand('undo');
                    setOpenMenu(null);
                  }}
                >
                  <span>Undo</span>
                  <span className="text-editor-menu-shortcut">Ctrl+Z</span>
                </div>
                <div
                  className="text-editor-menu-item"
                  onClick={() => {
                    document.execCommand('redo');
                    setOpenMenu(null);
                  }}
                >
                  <span>Redo</span>
                  <span className="text-editor-menu-shortcut">Ctrl+Y</span>
                </div>
                <div className="text-editor-menu-separator" />
                <div
                  className="text-editor-menu-item"
                  onClick={() => {
                    setShowFind(true);
                    setShowReplace(false);
                    setOpenMenu(null);
                  }}
                >
                  <span>Find</span>
                  <span className="text-editor-menu-shortcut">Ctrl+F</span>
                </div>
                <div
                  className="text-editor-menu-item"
                  onClick={() => {
                    setShowFind(true);
                    setShowReplace(true);
                    setOpenMenu(null);
                  }}
                >
                  <span>Replace</span>
                  <span className="text-editor-menu-shortcut">Ctrl+H</span>
                </div>
                <div className="text-editor-menu-separator" />
                <div
                  className="text-editor-menu-item"
                  onClick={() => {
                    setShowGoto(true);
                    setOpenMenu(null);
                  }}
                >
                  <span>Go to Line...</span>
                  <span className="text-editor-menu-shortcut">Ctrl+G</span>
                </div>
              </div>
            )}
          </div>
          {/* View Menu */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className={`text-editor-menu-btn${openMenu === 'view' ? ' active' : ''}`}
              onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
            >
              View
            </button>
            {openMenu === 'view' && (
              <div className="text-editor-menu-dropdown">
                <div
                  className="text-editor-menu-item"
                  onClick={() => {
                    updateSetting('lineWrapEnabled', !lineWrapEnabled);
                    setOpenMenu(null);
                  }}
                >
                  <span>{lineWrapEnabled ? '\u2713 ' : '\u2003 '}Line Wrap</span>
                </div>
                <div
                  className="text-editor-menu-item"
                  onClick={() => {
                    setShowReturnCodes(!showReturnCodes);
                    setOpenMenu(null);
                  }}
                >
                  <span>{showReturnCodes ? '\u2713 ' : '\u2003 '}Show Return Codes</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="text-editor-status">
          {isTabDirty(activeTab) && <span title="Unsaved changes">Modified</span>}
          <span>
            Ln {cursorLine}, Col {cursorCol}
          </span>

          <div style={{ position: 'relative' }}>
            <span
              className="text-editor-status-item"
              onClick={() => {
                setShowLineEndingPicker(!showLineEndingPicker);
                setShowEncodingPicker(false);
              }}
            >
              {activeTab.lineEnding}
            </span>
            {showLineEndingPicker && (
              <div className="text-editor-select-dropdown">
                {LINE_ENDINGS.map((le) => (
                  <div
                    key={le}
                    className={`text-editor-select-item${le === activeTab.lineEnding ? ' selected' : ''}`}
                    onClick={() => handleLineEndingChange(le)}
                  >
                    {le}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <span
              className="text-editor-status-item"
              onClick={() => {
                setShowEncodingPicker(!showEncodingPicker);
                setShowLineEndingPicker(false);
              }}
            >
              {activeTab.encoding.toUpperCase()}
            </span>
            {showEncodingPicker && (
              <div className="text-editor-select-dropdown">
                {ENCODINGS.map((enc) => (
                  <div
                    key={enc}
                    className={`text-editor-select-item${enc === activeTab.encoding ? ' selected' : ''}`}
                    onClick={() => handleEncodingChange(enc)}
                  >
                    {enc.toUpperCase()}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Find/Replace Bar */}
      {showFind && (
        <div className="text-editor-find-bar">
          <span className="text-editor-find-label">Find:</span>
          <input
            ref={findInputRef}
            className="text-editor-find-input"
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFindNext();
              if (e.key === 'Escape') {
                setShowFind(false);
                setShowReplace(false);
              }
            }}
            placeholder="Search..."
          />
          <button type="button" className="text-editor-find-btn" onClick={handleFindNext}>
            Next
          </button>
          {showReplace && (
            <>
              <span className="text-editor-find-label">Replace:</span>
              <input
                className="text-editor-find-input"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleReplaceCurrent();
                  if (e.key === 'Escape') {
                    setShowFind(false);
                    setShowReplace(false);
                  }
                }}
                placeholder="Replace..."
              />
              <button type="button" className="text-editor-find-btn" onClick={handleReplaceCurrent}>
                Replace
              </button>
              <button type="button" className="text-editor-find-btn" onClick={handleReplaceAll}>
                All
              </button>
            </>
          )}
          <button
            type="button"
            className="text-editor-find-close"
            onClick={() => {
              setShowFind(false);
              setShowReplace(false);
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Editor area */}
      <div className="text-editor-container">
        <div className="text-editor-line-numbers" ref={lineNumbersRef}>
          {visualLineNumbers.map((n, i) => (
            <div key={i} className="text-editor-line-number">
              {n}
            </div>
          ))}
        </div>
        <div className="text-editor-editor-wrapper">
          <textarea
            ref={textareaRef}
            className="text-editor-textarea"
            style={{
              whiteSpace: lineWrapEnabled ? 'pre-wrap' : 'pre',
              wordWrap: lineWrapEnabled ? 'break-word' : 'normal',
            }}
            value={activeTab.content}
            onChange={handleContentChange}
            onScroll={handleTextareaScroll}
            onClick={updateCursorPosition}
            onKeyUp={updateCursorPosition}
            spellCheck={false}
            wrap={lineWrapEnabled ? 'soft' : 'off'}
          />
          {showReturnCodes && (
            <div
              ref={overlayRef}
              className="text-editor-return-overlay"
              style={{
                whiteSpace: lineWrapEnabled ? 'pre-wrap' : 'pre',
                wordWrap: lineWrapEnabled ? 'break-word' : 'normal',
                overflowWrap: lineWrapEnabled ? 'break-word' : 'normal',
              }}
            >
              {activeTab.content.split('\n').map((line, i, arr) => (
                <span key={i}>
                  <span className="text-editor-return-text">{line || '\u200b'}</span>
                  {i < arr.length - 1 && <span className="text-editor-newline-symbol">{'\u21B5'}</span>}
                  {i < arr.length - 1 && '\n'}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Go to Line dialog */}
      {showGoto && (
        <div className="text-editor-goto-overlay" onClick={() => setShowGoto(false)}>
          <div className="text-editor-goto-dialog" onClick={(e) => e.stopPropagation()}>
            <label>Go to Line (1-{activeTab.content.split('\n').length}):</label>
            <input
              ref={gotoInputRef}
              type="number"
              min={1}
              max={activeTab.content.split('\n').length}
              value={gotoValue}
              onChange={(e) => setGotoValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleGotoLine();
                if (e.key === 'Escape') setShowGoto(false);
              }}
            />
          </div>
        </div>
      )}

      {pendingCloseTab && (
        <SaveConfirmModal
          filename={
            pendingCloseTab.filePath
              ? filenameFromPath(pendingCloseTab.filePath)
              : 'Untitled'
          }
          onSave={handleSaveConfirmSave}
          onDiscard={handleSaveConfirmDiscard}
          onCancel={handleSaveConfirmCancel}
        />
      )}
    </div>
  );
}
