import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { TextEditorTab } from '../../hooks/useSessionManager';
import { useSettings } from '../../hooks/useSettings';
import * as electronService from '../../services/electronService';
import './TextEditorPane.css';

interface TextEditorState {
    tabs: TextEditorTab[];
    activeTabId: string;
}

interface TextEditorPaneProps {
    sessionId: string;
    initialState?: TextEditorState;
    onStateChange?: (newState: Partial<TextEditorState>) => void;
}

const ENCODINGS = ['utf-8', 'ascii', 'latin1'] as const;
const LINE_ENDINGS = ['CRLF', 'LF'] as const;

export const TextEditorPane: React.FC<TextEditorPaneProps> = React.memo(({
    sessionId,
    initialState,
    onStateChange,
}) => {
    const { settings: { lineWrapEnabled } } = useSettings();
    const [tabs, setTabs] = useState<TextEditorTab[]>(initialState?.tabs ?? [{
        id: self.crypto.randomUUID(),
        filePath: null,
        content: '',
        savedContent: '',
        encoding: 'utf-8',
        lineEnding: 'CRLF',
    }]);
    const [activeTabId, setActiveTabId] = useState(initialState?.activeTabId ?? tabs[0].id);

    const [cursorLine, setCursorLine] = useState(1);
    const [cursorCol, setCursorCol] = useState(1);

    // Menu state
    const [openMenu, setOpenMenu] = useState<'file' | 'edit' | 'view' | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Find/Replace state
    const [showFind, setShowFind] = useState(false);
    const [showReplace, setShowReplace] = useState(false);
    const [findText, setFindText] = useState('');
    const [replaceText, setReplaceText] = useState('');

    // GoTo line dialog
    const [showGoto, setShowGoto] = useState(false);
    const [gotoValue, setGotoValue] = useState('');

    // Return code display
    const [showReturnCodes, setShowReturnCodes] = useState(true);

    // Encoding/Line ending dropdowns
    const [showEncodingPicker, setShowEncodingPicker] = useState(false);
    const [showLineEndingPicker, setShowLineEndingPicker] = useState(false);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lineNumbersRef = useRef<HTMLDivElement>(null);
    const subtabListRef = useRef<HTMLDivElement>(null);
    const findInputRef = useRef<HTMLInputElement>(null);
    const gotoInputRef = useRef<HTMLInputElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const measurerRef = useRef<HTMLDivElement | null>(null);

    // Visual line numbers: number for the first visual row of each logical line, '' for wrapped rows
    const [visualLineNumbers, setVisualLineNumbers] = useState<(number | '')[]>([1]);

    // Get the active tab
    const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];

    // Auto-scroll the active sub-tab into view
    useEffect(() => {
        const container = subtabListRef.current;
        if (!container) return;
        const activeEl = container.querySelector('.text-editor-subtab.active') as HTMLElement | null;
        if (activeEl && activeEl.scrollIntoView) {
            activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }, [activeTabId]);

    // Enable horizontal scrolling with mouse wheel on sub-tab bar
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

    // Sync state up to session manager
    const syncState = useCallback((updatedTabs: TextEditorTab[], newActiveTabId?: string) => {
        onStateChange?.({
            tabs: updatedTabs,
            activeTabId: newActiveTabId ?? activeTabId,
        });
    }, [onStateChange, activeTabId]);

    // Update a single tab's data
    const updateTab = useCallback((tabId: string, updates: Partial<TextEditorTab>) => {
        setTabs(prev => {
            const next = prev.map(t => t.id === tabId ? { ...t, ...updates } : t);
            syncState(next);
            return next;
        });
    }, [syncState]);

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

    // Compute visual line numbers, accounting for line wrap
    const computeVisualLineNumbers = useCallback(() => {
        const lines = activeTab.content.split('\n');
        if (!lineWrapEnabled) {
            setVisualLineNumbers(lines.map((_, i) => i + 1));
            return;
        }
        const ta = textareaRef.current;
        if (!ta) return;
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
        // Batch write all lines then read heights in one pass — avoids O(n) reflows.
        const spans = lines.map(line => {
            const el = document.createElement('div');
            el.textContent = line || '\u200b';
            return el;
        });
        measurer.replaceChildren(...spans);
        const heights = spans.map(el => el.offsetHeight);
        measurer.replaceChildren();
        const result: (number | '')[] = [];
        heights.forEach((height, i) => {
            const visualCount = Math.max(1, Math.round(height / lineHeightPx));
            result.push(i + 1);
            for (let j = 1; j < visualCount; j++) result.push('');
        });
        setVisualLineNumbers(result);
    }, [activeTab.content, lineWrapEnabled]);

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

    // Double-click: select the entire line without the newline character
    const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
        e.preventDefault();
        const ta = textareaRef.current;
        if (!ta) return;
        const pos = ta.selectionStart;
        const content = ta.value;
        const lineStart = content.lastIndexOf('\n', pos - 1) + 1;
        let lineEnd = content.indexOf('\n', pos);
        if (lineEnd === -1) lineEnd = content.length;
        ta.setSelectionRange(lineStart, lineEnd);
        updateCursorPosition();
    }, [updateCursorPosition]);

    // Content change
    const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newContent = e.target.value;
        updateTab(activeTabId, { content: newContent });
        updateCursorPosition();
    }, [activeTabId, updateTab, updateCursorPosition]);

    // Sub-tab operations
    const addNewTab = useCallback(() => {
        const newTab: TextEditorTab = {
            id: self.crypto.randomUUID(),
            filePath: null,
            content: '',
            savedContent: '',
            encoding: 'utf-8',
            lineEnding: 'CRLF',
        };
        setTabs(prev => {
            const next = [...prev, newTab];
            syncState(next, newTab.id);
            return next;
        });
        setActiveTabId(newTab.id);
    }, [syncState]);

    const closeTab = useCallback((tabId: string) => {
        setTabs(prev => {
            if (prev.length <= 1) {
                // Last tab: reset to empty instead of closing
                const resetTab: TextEditorTab = {
                    id: prev[0].id,
                    filePath: null,
                    content: '',
                    savedContent: '',
                    encoding: 'utf-8',
                    lineEnding: 'CRLF',
                };
                const next = [resetTab];
                syncState(next, resetTab.id);
                setActiveTabId(resetTab.id);
                return next;
            }
            const idx = prev.findIndex(t => t.id === tabId);
            const next = prev.filter(t => t.id !== tabId);
            // If closing active tab, switch to neighbor
            if (tabId === activeTabId) {
                const newIdx = Math.min(idx, next.length - 1);
                const newActiveId = next[newIdx].id;
                setActiveTabId(newActiveId);
                syncState(next, newActiveId);
            } else {
                syncState(next);
            }
            return next;
        });
    }, [activeTabId, syncState]);

    const switchTab = useCallback((tabId: string) => {
        setActiveTabId(tabId);
        onStateChange?.({ activeTabId: tabId });
        setCursorLine(1);
        setCursorCol(1);
    }, [onStateChange]);

    // File operations
    const handleNew = useCallback(() => {
        addNewTab();
        setOpenMenu(null);
    }, [addNewTab]);

    const handleOpen = useCallback(async () => {
        setOpenMenu(null);
        const path = await electronService.textEditorOpenFile();
        if (!path) return;
        try {
            const result = await electronService.textEditorReadFile(path, 'utf-8');
            // Check if there's an existing empty untitled tab to reuse
            const emptyTab = tabs.find(t => t.id === activeTabId && !t.filePath && !t.content);
            if (emptyTab) {
                updateTab(emptyTab.id, {
                    filePath: path,
                    content: result.content,
                    savedContent: result.content,
                    lineEnding: result.lineEnding as 'LF' | 'CRLF',
                });
            } else {
                // Create a new tab for the opened file
                const newTab: TextEditorTab = {
                    id: self.crypto.randomUUID(),
                    filePath: path,
                    content: result.content,
                    savedContent: result.content,
                    encoding: 'utf-8',
                    lineEnding: result.lineEnding as 'LF' | 'CRLF',
                };
                setTabs(prev => {
                    const next = [...prev, newTab];
                    syncState(next, newTab.id);
                    return next;
                });
                setActiveTabId(newTab.id);
            }
        } catch (err) {
            console.error('Failed to open file:', err);
        }
    }, [tabs, activeTabId, updateTab, syncState]);

    const handleSave = useCallback(async () => {
        setOpenMenu(null);
        let savePath = activeTab.filePath;
        if (!savePath) {
            savePath = await electronService.textEditorSaveFile();
            if (!savePath) return;
            updateTab(activeTabId, { filePath: savePath });
        }
        try {
            let saveContent = activeTab.content;
            if (activeTab.lineEnding === 'CRLF') {
                saveContent = activeTab.content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
            } else {
                saveContent = activeTab.content.replace(/\r\n/g, '\n');
            }
            await electronService.textEditorWriteFile(savePath, saveContent, activeTab.encoding);
            updateTab(activeTabId, { savedContent: activeTab.content, filePath: savePath });
        } catch (err) {
            console.error('Failed to save file:', err);
        }
    }, [activeTab, activeTabId, updateTab]);

    const handleSaveAs = useCallback(async () => {
        setOpenMenu(null);
        const savePath = await electronService.textEditorSaveFile(activeTab.filePath || undefined);
        if (!savePath) return;
        try {
            let saveContent = activeTab.content;
            if (activeTab.lineEnding === 'CRLF') {
                saveContent = activeTab.content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
            } else {
                saveContent = activeTab.content.replace(/\r\n/g, '\n');
            }
            await electronService.textEditorWriteFile(savePath, saveContent, activeTab.encoding);
            updateTab(activeTabId, { savedContent: activeTab.content, filePath: savePath });
        } catch (err) {
            console.error('Failed to save file:', err);
        }
    }, [activeTab, activeTabId, updateTab]);

    // Close tab from File menu
    const handleCloseTab = useCallback(() => {
        setOpenMenu(null);
        closeTab(activeTabId);
    }, [activeTabId, closeTab]);

    // Find operations
    const handleFindNext = useCallback(() => {
        const ta = textareaRef.current;
        if (!ta || !findText) return;
        const startPos = ta.selectionEnd;
        const idx = activeTab.content.indexOf(findText, startPos);
        if (idx !== -1) {
            ta.focus();
            ta.setSelectionRange(idx, idx + findText.length);
        } else {
            const wrapIdx = activeTab.content.indexOf(findText);
            if (wrapIdx !== -1) {
                ta.focus();
                ta.setSelectionRange(wrapIdx, wrapIdx + findText.length);
            }
        }
    }, [activeTab.content, findText]);

    const handleReplaceCurrent = useCallback(() => {
        const ta = textareaRef.current;
        if (!ta || !findText) return;
        const selStart = ta.selectionStart;
        const selEnd = ta.selectionEnd;
        const selected = activeTab.content.substring(selStart, selEnd);
        if (selected === findText) {
            const newContent = activeTab.content.substring(0, selStart) + replaceText + activeTab.content.substring(selEnd);
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

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const paneEl = textareaRef.current?.closest('.text-editor-pane');
            if (!paneEl?.contains(document.activeElement) && document.activeElement !== textareaRef.current) return;

            if (e.ctrlKey) {
                switch (e.key) {
                    case 'o':
                        e.preventDefault();
                        handleOpen();
                        break;
                    case 's':
                        e.preventDefault();
                        if (e.shiftKey) {
                            handleSaveAs();
                        } else {
                            handleSave();
                        }
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
    }, [handleOpen, handleSave, handleSaveAs, closeTab, activeTabId]);

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

    // Focus find input when shown
    useEffect(() => {
        if (showFind) {
            findInputRef.current?.focus();
        }
    }, [showFind]);

    // Focus goto input when shown
    useEffect(() => {
        if (showGoto) {
            gotoInputRef.current?.focus();
        }
    }, [showGoto]);

    // Load file content when initialState has a filePath but empty content (opened from file association)
    useEffect(() => {
        if (!initialState?.tabs) return;
        initialState.tabs.forEach(tab => {
            if (tab.filePath && !tab.content) {
                electronService.textEditorReadFile(tab.filePath, tab.encoding || 'utf-8').then((result: { content: string; lineEnding: string }) => {
                    updateTab(tab.id, {
                        content: result.content,
                        savedContent: result.content,
                        lineEnding: result.lineEnding as 'LF' | 'CRLF',
                    });
                }).catch((err: unknown) => {
                    console.error('Failed to load file:', err);
                });
            }
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Cleanup measurer div on unmount
    useEffect(() => {
        return () => {
            if (measurerRef.current) {
                document.body.removeChild(measurerRef.current);
                measurerRef.current = null;
            }
        };
    }, []);

    // Recompute visual line numbers whenever content or wrap setting changes
    useEffect(() => {
        computeVisualLineNumbers();
    }, [computeVisualLineNumbers]);

    // Recompute on textarea resize (relevant when line wrap is on)
    useEffect(() => {
        if (!lineWrapEnabled) return;
        const ta = textareaRef.current;
        if (!ta) return;
        const observer = new ResizeObserver(() => computeVisualLineNumbers());
        observer.observe(ta);
        return () => observer.disconnect();
    }, [lineWrapEnabled, computeVisualLineNumbers]);

    // Encoding change handler
    const handleEncodingChange = useCallback(async (newEncoding: string) => {
        setShowEncodingPicker(false);
        updateTab(activeTabId, { encoding: newEncoding });

        // Re-read file with new encoding if file exists
        if (activeTab.filePath) {
            try {
                const result = await electronService.textEditorReadFile(activeTab.filePath, newEncoding);
                updateTab(activeTabId, {
                    encoding: newEncoding,
                    content: result.content,
                    savedContent: result.content,
                });
            } catch (err) {
                console.error('Failed to re-read file with encoding:', err);
            }
        }
    }, [activeTab.filePath, activeTabId, updateTab]);

    const handleLineEndingChange = useCallback((newLineEnding: 'LF' | 'CRLF') => {
        setShowLineEndingPicker(false);
        updateTab(activeTabId, { lineEnding: newLineEnding });
    }, [activeTabId, updateTab]);

    // Sub-tab middle-click close
    const handleSubTabMouseDown = useCallback((e: React.MouseEvent, tabId: string) => {
        if (e.button === 1) {
            e.preventDefault();
            closeTab(tabId);
        }
    }, [closeTab]);

    // Sub-tab drag reorder
    const [dragTabId, setDragTabId] = useState<string | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);
    const [dropAtEnd, setDropAtEnd] = useState(false);

    const handleTabDragStart = useCallback((e: React.DragEvent, tabId: string) => {
        setDragTabId(tabId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-tab-id', tabId);
    }, []);

    const handleTabDragOver = useCallback((e: React.DragEvent, tabId: string) => {
        if (!dragTabId || dragTabId === tabId) {
            setDropTargetId(null);
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTargetId(tabId);
        setDropAtEnd(false);
    }, [dragTabId]);

    const handleTabDrop = useCallback((e: React.DragEvent, targetTabId: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragTabId || dragTabId === targetTabId) {
            setDragTabId(null);
            setDropTargetId(null);
            setDropAtEnd(false);
            return;
        }
        setTabs(prev => {
            const fromIdx = prev.findIndex(t => t.id === dragTabId);
            const toIdx = prev.findIndex(t => t.id === targetTabId);
            if (fromIdx === -1 || toIdx === -1) return prev;
            const next = [...prev];
            const [moved] = next.splice(fromIdx, 1);
            next.splice(toIdx, 0, moved);
            syncState(next);
            return next;
        });
        setDragTabId(null);
        setDropTargetId(null);
        setDropAtEnd(false);
    }, [dragTabId, syncState]);

    const handleTabDragEnd = useCallback(() => {
        setDragTabId(null);
        setDropTargetId(null);
        setDropAtEnd(false);
    }, []);

    const handleSubtabListDragOver = useCallback((e: React.DragEvent) => {
        if (e.target !== e.currentTarget) return;
        if (!dragTabId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTargetId(null);
        setDropAtEnd(true);
    }, [dragTabId]);

    const handleSubtabListDrop = useCallback((e: React.DragEvent) => {
        if (e.target !== e.currentTarget) return;
        if (!dragTabId) return;
        e.preventDefault();
        setDropAtEnd(false);
        setTabs(prev => {
            const fromIdx = prev.findIndex(t => t.id === dragTabId);
            if (fromIdx === -1 || fromIdx === prev.length - 1) return prev;
            const next = [...prev];
            const [moved] = next.splice(fromIdx, 1);
            next.push(moved);
            syncState(next);
            return next;
        });
        setDragTabId(null);
        setDropTargetId(null);
    }, [dragTabId, syncState]);

    // Drag & drop file support
    const [isDragOver, setIsDragOver] = useState(false);
    const dragCounterRef = useRef(0);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        if (e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'application/json') !== -1) return;
        e.preventDefault();
        e.stopPropagation();
        if (dragTabId) return; // Ignore file overlay during tab reorder
        dragCounterRef.current++;
        if (Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) {
            setIsDragOver(true);
        }
    }, [dragTabId]);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        if (e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'application/json') !== -1) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) {
            setIsDragOver(false);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'application/json') !== -1) return;
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        if (e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'application/json') !== -1) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        for (const file of files) {
            const filePath = electronService.getFilePath(file);
            if (!filePath) continue;

            // Check if this file is already open
            const existingTab = tabs.find(t => t.filePath === filePath);
            if (existingTab) {
                switchTab(existingTab.id);
                continue;
            }

            try {
                await electronService.textEditorApproveDroppedFile(filePath);
                const result = await electronService.textEditorReadFile(filePath, 'utf-8');
                // Check if there's an existing empty untitled tab to reuse
                const emptyTab = tabs.find(t => t.id === activeTabId && !t.filePath && !t.content);
                if (emptyTab) {
                    updateTab(emptyTab.id, {
                        filePath,
                        content: result.content,
                        savedContent: result.content,
                        lineEnding: result.lineEnding as 'LF' | 'CRLF',
                    });
                } else {
                    const newTab: TextEditorTab = {
                        id: self.crypto.randomUUID(),
                        filePath,
                        content: result.content,
                        savedContent: result.content,
                        encoding: 'utf-8',
                        lineEnding: result.lineEnding as 'LF' | 'CRLF',
                    };
                    setTabs(prev => {
                        const next = [...prev, newTab];
                        syncState(next, newTab.id);
                        return next;
                    });
                    setActiveTabId(newTab.id);
                }
            } catch (err) {
                console.error('Failed to open dropped file:', err);
            }
        }
    }, [tabs, activeTabId, updateTab, syncState, switchTab]);

    return (
        <div
            className="text-editor-pane"
            data-session-id={sessionId}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {/* Sub-tab bar */}
            <div className="text-editor-subtab-bar">
                <div className="text-editor-subtab-list" ref={subtabListRef} onDragOver={handleSubtabListDragOver} onDrop={handleSubtabListDrop}>
                    {tabs.map((tab, tabIndex) => {
                        const fileName = tab.filePath ? tab.filePath.replace(/^.*[\\/]/, '') : 'Untitled';
                        const isDirty = tab.content !== tab.savedContent;
                        const isLastTab = tabIndex === tabs.length - 1;
                        return (
                            <div
                                key={tab.id}
                                className={`text-editor-subtab ${tab.id === activeTabId ? 'active' : ''}${dragTabId === tab.id ? ' dragging' : ''}${dropTargetId === tab.id ? ' drop-target' : ''}${dropAtEnd && isLastTab ? ' drop-target-right' : ''}`}
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
                                    {isDirty && <span className="text-editor-subtab-dirty">{'\u25CF'} </span>}
                                    {fileName}
                                </span>
                                <div
                                    className="text-editor-subtab-close"
                                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                                >
                                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="text-editor-subtab-new" onClick={addNewTab} title="New Tab">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </div>
            </div>

            {/* Toolbar: menus + status */}
            <div className="text-editor-toolbar">
                <div className="text-editor-menus" ref={menuRef}>
                    {/* File Menu */}
                    <div style={{ position: 'relative' }}>
                        <button
                            className={`text-editor-menu-btn ${openMenu === 'file' ? 'active' : ''}`}
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
                            className={`text-editor-menu-btn ${openMenu === 'edit' ? 'active' : ''}`}
                            onClick={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')}
                        >
                            Edit
                        </button>
                        {openMenu === 'edit' && (
                            <div className="text-editor-menu-dropdown">
                                <div className="text-editor-menu-item" onClick={() => { document.execCommand('undo'); setOpenMenu(null); }}>
                                    <span>Undo</span>
                                    <span className="text-editor-menu-shortcut">Ctrl+Z</span>
                                </div>
                                <div className="text-editor-menu-item" onClick={() => { document.execCommand('redo'); setOpenMenu(null); }}>
                                    <span>Redo</span>
                                    <span className="text-editor-menu-shortcut">Ctrl+Y</span>
                                </div>
                                <div className="text-editor-menu-separator" />
                                <div className="text-editor-menu-item" onClick={() => { setShowFind(true); setShowReplace(false); setOpenMenu(null); }}>
                                    <span>Find</span>
                                    <span className="text-editor-menu-shortcut">Ctrl+F</span>
                                </div>
                                <div className="text-editor-menu-item" onClick={() => { setShowFind(true); setShowReplace(true); setOpenMenu(null); }}>
                                    <span>Replace</span>
                                    <span className="text-editor-menu-shortcut">Ctrl+H</span>
                                </div>
                                <div className="text-editor-menu-separator" />
                                <div className="text-editor-menu-item" onClick={() => { setShowGoto(true); setOpenMenu(null); }}>
                                    <span>Go to Line...</span>
                                    <span className="text-editor-menu-shortcut">Ctrl+G</span>
                                </div>
                            </div>
                        )}
                    </div>
                    {/* View Menu */}
                    <div style={{ position: 'relative' }}>
                        <button
                            className={`text-editor-menu-btn ${openMenu === 'view' ? 'active' : ''}`}
                            onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
                        >
                            View
                        </button>
                        {openMenu === 'view' && (
                            <div className="text-editor-menu-dropdown">
                                <div className="text-editor-menu-item" onClick={() => { setShowReturnCodes(!showReturnCodes); setOpenMenu(null); }}>
                                    <span>{showReturnCodes ? '\u2713 ' : '\u2003 '}Show Return Codes</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="text-editor-status">
                    {activeTab.content !== activeTab.savedContent && <span title="Unsaved changes">Modified</span>}
                    <span>Ln {cursorLine}, Col {cursorCol}</span>

                    <div style={{ position: 'relative' }}>
                        <span
                            className="text-editor-status-item"
                            onClick={() => { setShowLineEndingPicker(!showLineEndingPicker); setShowEncodingPicker(false); }}
                        >
                            {activeTab.lineEnding}
                        </span>
                        {showLineEndingPicker && (
                            <div className="text-editor-select-dropdown">
                                {LINE_ENDINGS.map(le => (
                                    <div
                                        key={le}
                                        className={`text-editor-select-item ${le === activeTab.lineEnding ? 'selected' : ''}`}
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
                            onClick={() => { setShowEncodingPicker(!showEncodingPicker); setShowLineEndingPicker(false); }}
                        >
                            {activeTab.encoding.toUpperCase()}
                        </span>
                        {showEncodingPicker && (
                            <div className="text-editor-select-dropdown">
                                {ENCODINGS.map(enc => (
                                    <div
                                        key={enc}
                                        className={`text-editor-select-item ${enc === activeTab.encoding ? 'selected' : ''}`}
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
                        onChange={e => setFindText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleFindNext(); if (e.key === 'Escape') { setShowFind(false); setShowReplace(false); } }}
                        placeholder="Search..."
                    />
                    <button className="text-editor-find-btn" onClick={handleFindNext}>Next</button>
                    {showReplace && (
                        <>
                            <span className="text-editor-find-label">Replace:</span>
                            <input
                                className="text-editor-find-input"
                                value={replaceText}
                                onChange={e => setReplaceText(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleReplaceCurrent(); if (e.key === 'Escape') { setShowFind(false); setShowReplace(false); } }}
                                placeholder="Replace..."
                            />
                            <button className="text-editor-find-btn" onClick={handleReplaceCurrent}>Replace</button>
                            <button className="text-editor-find-btn" onClick={handleReplaceAll}>All</button>
                        </>
                    )}
                    <button className="text-editor-find-close" onClick={() => { setShowFind(false); setShowReplace(false); }}>
                        &times;
                    </button>
                </div>
            )}

            {/* Editor area */}
            <div className="text-editor-container">
                <div className="text-editor-line-numbers" ref={lineNumbersRef}>
                    {visualLineNumbers.map((n, i) => (
                        <div key={i} className="text-editor-line-number">{n}</div>
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
                        onDoubleClick={handleDoubleClick}
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
                                <React.Fragment key={i}>
                                    <span className="text-editor-return-text">{line || '\u200b'}</span>
                                    {i < arr.length - 1 && <span className="text-editor-newline-symbol">{'\u21B5'}</span>}
                                    {i < arr.length - 1 && '\n'}
                                </React.Fragment>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Drop overlay */}
            {isDragOver && (
                <div className="text-editor-drop-overlay">
                    <div className="text-editor-drop-message">Drop files here to open</div>
                </div>
            )}

            {/* Go to Line dialog */}
            {showGoto && (
                <div className="text-editor-goto-overlay" onClick={() => setShowGoto(false)}>
                    <div className="text-editor-goto-dialog" onClick={e => e.stopPropagation()}>
                        <label>Go to Line (1-{activeTab.content.split('\n').length}):</label>
                        <input
                            ref={gotoInputRef}
                            type="number"
                            min={1}
                            max={activeTab.content.split('\n').length}
                            value={gotoValue}
                            onChange={e => setGotoValue(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleGotoLine();
                                if (e.key === 'Escape') setShowGoto(false);
                            }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
});
