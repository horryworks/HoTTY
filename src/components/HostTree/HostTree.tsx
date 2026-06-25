import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { HostTreeNode, HostEntry } from '../../types/appTypes';
import { flattenHosts, getJumpboxReferences } from '../../hooks/useHostManager';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useModalState } from '../../hooks/useModalState';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { tauriService } from '../../services/tauriService';
import './HostTree.css';

interface ContextMenuState {
    x: number;
    y: number;
    node: HostTreeNode | null;
}

interface EditModalState {
    mode: 'folder' | 'host' | 'export' | 'import';
    parentId: string | null;
    existingNode?: HostTreeNode;
}

interface HostTreeProps {
    tree: HostTreeNode[];
    selectedId: string | null;
    onSelect: (node: HostTreeNode) => void;
    onNewConnection?: () => void;
    onDoubleClickHost?: (node: HostTreeNode) => void;
    onAddFolder: (parentId: string | null, name: string) => void;
    onAddHost: (parentId: string | null, name: string, entry: HostEntry) => void;
    onEditNode: (id: string, patch: Partial<HostTreeNode>) => void;
    onDeleteNode: (id: string) => void;
    onMoveNode?: (nodeId: string, targetId: string, position: 'before' | 'after' | 'inside') => void;
    onSortFolder?: (folderId: string | null) => void;
    onImportData?: (nodes: HostTreeNode[], folderName: string, parentId: string | null) => Promise<string | undefined> | void;
    onShowMessage?: (type: 'error' | 'success' | 'info', title: string | undefined, message: string) => void;
}

export const HostTree: React.FC<HostTreeProps> = ({
    tree,
    selectedId,
    onSelect,
    onNewConnection,
    onDoubleClickHost,
    onAddFolder,
    onAddHost,
    onEditNode,
    onDeleteNode,
    onMoveNode,
    onSortFolder,
    onImportData,
    onShowMessage,
}) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [exportNode, setExportNode] = useState<HostTreeNode | null>(null);
    const [editModalOpen, openEditModal, closeEditModal, editModal] = useModalState<EditModalState>();
    const [nodeToDeleteOpen, openNodeToDelete, closeNodeToDelete, nodeToDelete] = useModalState<HostTreeNode>();

    // Inline edit state
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');

    const [formName, setFormName] = useState('');
    const [formProtocol, setFormProtocol] = useState<'ssh' | 'telnet'>('ssh');
    const [formHost, setFormHost] = useState('');
    const [formPort, setFormPort] = useState('22');
    const [formUsername, setFormUsername] = useState('');
    const [formPassword, setFormPassword] = useState('');
    const [formIsJumpbox, setFormIsJumpbox] = useState(false);
    const [importFilePath, setImportFilePath] = useState<string | null>(null);
    const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<{ nodeId: string; position: 'before' | 'after' | 'inside' } | null>(null);
    const modalInputRef = useRef<HTMLInputElement>(null);

    const focusModal = useCallback(() => {
        setTimeout(() => {
            if (modalInputRef.current) {
                modalInputRef.current.focus();
                try {
                    tauriService.focusWindow();
                    window.focus();
                } catch { /* focus best-effort */ }
            }
        }, 200);
    }, []);

    const containerRef = useRef<HTMLDivElement>(null);
    const editModalRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);

    useFocusTrap(editModalRef, editModalOpen);

    useEffect(() => {
        const handler = () => setContextMenu(null);
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, []);

    useEffect(() => {
        if (editModalOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setEditingNodeId(null);
            focusModal();
        }
    }, [editModalOpen, focusModal]);

    useLayoutEffect(() => {
        if (contextMenu && contextMenuRef.current) {
            const menu = contextMenuRef.current;
            const rect = menu.getBoundingClientRect();
            let adjustedX = contextMenu.x;
            let adjustedY = contextMenu.y;

            if (adjustedX + rect.width > window.innerWidth) {
                adjustedX = window.innerWidth - rect.width - 5;
            }
            if (adjustedY + rect.height > window.innerHeight) {
                adjustedY = window.innerHeight - rect.height - 5;
            }

            if (adjustedX !== contextMenu.x || adjustedY !== contextMenu.y) {
                menu.style.left = `${adjustedX}px`;
                menu.style.top = `${adjustedY}px`;
            }
        }
    }, [contextMenu]);

    const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

    const getTargetParentId = useCallback(() => {
        if (!selectedId) return null;

        let targetParentId: string | null = null;
        const findNodeInfo = (nodes: HostTreeNode[], parentId: string | null): boolean => {
            for (const n of nodes) {
                if (n.id === selectedId) {
                    if (n.type === 'folder') {
                        targetParentId = n.id;
                    } else {
                        targetParentId = parentId;
                    }
                    return true;
                }
                if (n.children) {
                    if (findNodeInfo(n.children, n.id)) return true;
                }
            }
            return false;
        };

        findNodeInfo(tree, null);
        return targetParentId;
    }, [selectedId, tree]);

    const openContextMenu = useCallback((e: React.MouseEvent, node: HostTreeNode | null) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, node });
    }, []);

    const openAddFolder = useCallback((parentId: string | null) => {
        setFormName('');
        openEditModal({ mode: 'folder', parentId });
        setContextMenu(null);
    }, [openEditModal]);

    const openAddHost = useCallback((parentId: string | null) => {
        setFormName('');
        setFormProtocol('ssh');
        setFormHost('');
        setFormPort('22');
        setFormUsername('');
        setFormPassword('');
        setFormIsJumpbox(false);
        openEditModal({ mode: 'host', parentId });
        setContextMenu(null);
    }, [openEditModal]);

    const handleExport = (node: HostTreeNode | null = null) => {
        setExportNode(node);
        setFormName('');
        setFormPassword('');
        openEditModal({ mode: 'export', parentId: null });
        setContextMenu(null);
    };

    const handleImport = async (parentId: string | null = null) => {
        try {
            const filePath = await tauriService.selectImportFile();
            if (!filePath) return;
            setImportFilePath(filePath);
            setFormPassword('');
            openEditModal({ mode: 'import', parentId });
            setContextMenu(null);
        } catch (err: unknown) {
            onShowMessage?.('error', t('hostTree.messages.importErrorTitle'), t('hostTree.messages.importErrorBody', { error: err instanceof Error ? err.message : String(err) }));
        }
    };

    const handleModalSubmit = async () => {
        if (!editModal) return;
        const { mode, parentId, existingNode } = editModal;

        if (mode === 'export') {
            if (!formPassword) return;
            try {
                const dataToExport = exportNode ? [exportNode] : tree;
                const result = await tauriService.exportHtree(JSON.stringify(dataToExport), formPassword);

                closeEditModal();
                setExportNode(null);
                setFormPassword('');

                if (result.success) {
                    setTimeout(() => {
                        onShowMessage?.('success', t('hostTree.messages.exportSuccessTitle'), t('hostTree.messages.exportSuccessBody'));
                        focusModal();
                    }, 50);
                } else if (result.error) {
                    onShowMessage?.('error', t('hostTree.messages.exportFailedTitle'), result.error);
                }
            } catch (err: unknown) {
                onShowMessage?.('error', t('hostTree.messages.exportFailedTitle'), err instanceof Error ? err.message : String(err));
            }
            return;
        }

        if (mode === 'import') {
            if (!formPassword || !importFilePath) return;
            try {
                const rawData = await tauriService.decryptImportFile(formPassword);
                const data = JSON.parse(rawData) as HostTreeNode[];
                if (data && onImportData) {
                    const pathParts = importFilePath.split(/[\\/]/);
                    const fileNameWithExt = pathParts[pathParts.length - 1];
                    const fileName = fileNameWithExt.replace(/\.[^/.]+$/, "");

                    const currentParentId = parentId;
                    const folderId = await onImportData(data, currentParentId ? '' : `Imported_${fileName}`, currentParentId);

                    if (folderId) {
                        setExpanded(prev => ({ ...prev, [folderId]: true }));
                    }

                    closeEditModal();
                    setImportFilePath(null);
                    setFormPassword('');

                    setTimeout(() => {
                        onShowMessage?.('success', t('hostTree.messages.importSuccessTitle'), currentParentId ? t('hostTree.messages.importSuccessBody') : t('hostTree.messages.importSuccessIntoFolder', { folderName: `Imported_${fileName}` }));
                        focusModal();
                    }, 50);
                }
            } catch (err: unknown) {
                onShowMessage?.('error', t('hostTree.messages.importFailedTitle'), err instanceof Error ? err.message : String(err));
            }
            return;
        }

        const defaultPort = formProtocol === 'ssh' ? 22 : 23;
        const port = Number.parseInt(formPort, 10) || defaultPort;

        if (existingNode) {
            if (mode === 'folder') {
                onEditNode(existingNode.id, { name: formName });
            } else {
                // Spread the existing entry first so fields this add/edit form
                // does not surface — privateKeyPath, privateKeyPassphrase,
                // iapTunnel — are preserved rather than silently dropped on
                // save. The form fields then override only what they own.
                const entry: HostEntry = {
                    ...existingNode.entry,
                    protocol: formProtocol,
                    host: formHost,
                    port,
                    username: formUsername || undefined,
                    password: formPassword || undefined,
                    isJumpbox: formProtocol === 'ssh' ? (formIsJumpbox || undefined) : undefined,
                };
                onEditNode(existingNode.id, { name: formName, entry });
            }
        } else {
            if (mode === 'folder') {
                onAddFolder(parentId, formName);
            } else {
                const entry: HostEntry = {
                    protocol: formProtocol,
                    host: formHost,
                    port,
                    username: formUsername || undefined,
                    password: formPassword || undefined,
                    isJumpbox: formProtocol === 'ssh' ? (formIsJumpbox || undefined) : undefined,
                };
                onAddHost(parentId, formName, entry);
            }
        }
        closeEditModal();
    };

    const renderNode = (node: HostTreeNode, depth: number): React.ReactNode => {
        const isExpanded = expanded[node.id] ?? true;
        const isSelected = selectedId === node.id;
        const isDragging = draggedNodeId === node.id;
        const isDropTarget = dropTarget?.nodeId === node.id;
        const dropPosition = isDropTarget ? dropTarget.position : null;

        const dragClasses = [
            isDragging ? 'dragging' : '',
            dropPosition === 'before' ? 'drag-over-before' : '',
            dropPosition === 'after' ? 'drag-over-after' : '',
            dropPosition === 'inside' ? 'drag-over-inside' : '',
        ].filter(Boolean).join(' ');

        return (
            <div key={node.id} className="host-tree-node">
                <div
                    className={`host-tree-row ${isSelected ? 'selected' : ''} ${dragClasses}`}
                    style={{ paddingLeft: `${depth * 14 + 8}px` }}
                    tabIndex={node.type === 'host' ? 0 : undefined}
                    draggable
                    onDragStart={(e) => {
                        setDraggedNodeId(node.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', node.id);
                    }}
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!draggedNodeId || draggedNodeId === node.id) return;
                        e.dataTransfer.dropEffect = 'move';

                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const h = rect.height;

                        let position: 'before' | 'after' | 'inside';
                        const isNodeExpanded = expanded[node.id] ?? true;

                        if (node.type === 'folder') {
                            if (isNodeExpanded && node.children && node.children.length > 0) {
                                if (y < h * 0.25) position = 'before';
                                else position = 'inside';
                            } else {
                                if (y < h * 0.25) position = 'before';
                                else if (y > h * 0.75) position = 'after';
                                else position = 'inside';
                            }
                        } else {
                            position = y < h * 0.5 ? 'before' : 'after';
                        }
                        setDropTarget({ nodeId: node.id, position });
                    }}
                    onDragLeave={(e) => {
                        const related = e.relatedTarget as HTMLElement;
                        if (!e.currentTarget.contains(related)) {
                            if (dropTarget?.nodeId === node.id) setDropTarget(null);
                        }
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!draggedNodeId || draggedNodeId === node.id || !onMoveNode) {
                            setDraggedNodeId(null);
                            setDropTarget(null);
                            return;
                        }

                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const h = rect.height;

                        let position: 'before' | 'after' | 'inside';
                        const isNodeExpanded = expanded[node.id] ?? true;

                        if (node.type === 'folder') {
                            if (isNodeExpanded && node.children && node.children.length > 0) {
                                if (y < h * 0.25) position = 'before';
                                else position = 'inside';
                            } else {
                                if (y < h * 0.25) position = 'before';
                                else if (y > h * 0.75) position = 'after';
                                else position = 'inside';
                            }
                        } else {
                            position = y < h * 0.5 ? 'before' : 'after';
                        }

                        onMoveNode(draggedNodeId, node.id, position);
                        setDraggedNodeId(null);
                        setDropTarget(null);
                    }}
                    onDragEnd={() => {
                        setDraggedNodeId(null);
                        setDropTarget(null);
                    }}
                    onClick={() => {
                        onSelect(node);
                        if (node.type === 'folder') toggle(node.id);
                    }}
                    onDoubleClick={() => {
                        if (node.type === 'host') onDoubleClickHost?.(node);
                    }}
                    onContextMenu={(e) => openContextMenu(e, node)}
                    onKeyDown={(e) => {
                        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                            e.preventDefault();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const containerRect = containerRef.current?.getBoundingClientRect();
                            const x = containerRect ? rect.left - containerRect.left : rect.left;
                            const y = containerRect ? rect.bottom - containerRect.top : rect.bottom;
                            setContextMenu({ x, y, node });
                        } else if (e.key === 'F2') {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingNodeId(node.id);
                            setEditingName(node.name);
                        }
                    }}
                >
                    {node.type === 'folder' ? (
                        <>
                            <span
                                className="tree-icon"
                                onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
                                style={{ opacity: (!node.children || node.children.length === 0) ? 0 : 1, cursor: (!node.children || node.children.length === 0) ? 'default' : 'pointer' }}
                            >
                                <svg
                                    className={`tree-chevron ${isExpanded ? 'expanded' : ''}`}
                                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                >
                                    <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                            </span>
                            <span className="tree-icon">{'\u{1F4C1}'}</span>
                        </>
                    ) : (
                        <>
                            <span className="tree-icon" style={{ opacity: 0 }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                            </span>
                            <span className="tree-icon">{node.entry?.isJumpbox ? '\u{1F517}' : '\u{1F5A5}'}</span>
                        </>
                    )}
                    <span className="tree-label">
                        {editingNodeId === node.id ? (
                            <input
                                autoFocus
                                type="text"
                                className="tree-label-edit-input"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onDoubleClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') {
                                        if (editingName.trim() && editingName !== node.name) {
                                            onEditNode(node.id, { name: editingName.trim() });
                                        }
                                        setEditingNodeId(null);
                                    } else if (e.key === 'Escape') {
                                        setEditingNodeId(null);
                                    }
                                }}
                                onBlur={() => {
                                    if (editingName.trim() && editingName !== node.name) {
                                        onEditNode(node.id, { name: editingName.trim() });
                                    }
                                    setEditingNodeId(null);
                                }}
                            />
                        ) : (
                            <>
                                {node.name}
                                {node.type === 'host' && node.entry && (
                                    <span className="tree-meta">
                                        {node.entry.protocol === 'gcloud-iap' ? (
                                            <>{' '}{node.entry.iapTunnel?.project}:{node.entry.iapTunnel?.instance} <span className="tree-meta-via">(IAP)</span></>
                                        ) : (
                                            <>
                                                {' '}{node.entry.host}
                                                {node.entry.jumpboxId && (() => {
                                                    const jb = flattenHosts(tree).find(n => n.id === node.entry!.jumpboxId);
                                                    return jb ? <span className="tree-meta-via"> via {jb.name}</span> : null;
                                                })()}
                                            </>
                                        )}
                                    </span>
                                )}
                            </>
                        )}
                    </span>
                </div>
                {node.type === 'folder' && isExpanded && node.children && (
                    <div className="host-tree-children">
                        {node.children.map(child => renderNode(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div
            className="host-tree-container"
            ref={containerRef}
            onContextMenu={(e) => openContextMenu(e, null)}
        >
            {/* Toolbar */}
            <div className="host-tree-toolbar">
                <div
                    className="tree-toolbar-btn"
                    role="button"
                    title={t('hostTree.toolbar.addFolder')}
                    onClick={() => openAddFolder(getTargetParentId())}
                    style={{ cursor: 'pointer' }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-folder)' }}>
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        <line x1="12" y1="11" x2="12" y2="17"></line>
                        <line x1="9" y1="14" x2="15" y2="14"></line>
                    </svg>
                </div>
                <div
                    className="tree-toolbar-btn"
                    role="button"
                    title={t('hostTree.toolbar.addHost')}
                    onClick={() => openAddHost(getTargetParentId())}
                    style={{ cursor: 'pointer' }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-host)' }}>
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                        <line x1="12" y1="6" x2="12" y2="14"></line>
                        <line x1="8" y1="10" x2="16" y2="10"></line>
                        <line x1="8" y1="21" x2="16" y2="21"></line>
                        <line x1="12" y1="17" x2="12" y2="21"></line>
                    </svg>
                </div>
                <div style={{ flex: 1 }} />
                <div
                    className="tree-toolbar-btn"
                    role="button"
                    title={t('hostTree.toolbar.exportTree')}
                    onClick={() => handleExport(null)}
                    style={{ cursor: 'pointer' }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-danger)' }}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                </div>
                <div
                    className="tree-toolbar-btn"
                    role="button"
                    title={t('hostTree.toolbar.importTree')}
                    onClick={() => handleImport(null)}
                    style={{ cursor: 'pointer' }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--success-color)' }}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                </div>
            </div>

            {/* Tree */}
            <div className="host-tree-body">
                {onNewConnection && (
                    <div
                        className={`host-tree-row new-connection ${selectedId === null ? 'selected' : ''}`}
                        style={{ paddingLeft: '8px' }}
                        role="button"
                        tabIndex={0}
                        title={t('hostTree.newConnectionTitle')}
                        onClick={onNewConnection}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onNewConnection();
                            }
                        }}
                    >
                        <span className="tree-icon" style={{ opacity: 0 }} aria-hidden="true">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </span>
                        <span className="tree-icon" aria-hidden="true">{'\u{1F195}'}</span>
                        <span className="tree-label">{t('hostTree.newConnection')}</span>
                    </div>
                )}
                {tree.length === 0 && (
                    <div className="host-tree-empty">{t('hostTree.empty')}</div>
                )}
                {tree.map(node => renderNode(node, 0))}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    ref={contextMenuRef}
                    className="context-menu"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {contextMenu.node?.type !== 'host' && (
                        <>
                            <button onClick={() => openAddFolder(contextMenu.node?.id ?? null)}>
                                <span className="menu-icon-wrapper">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-folder)' }}>
                                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                        <line x1="12" y1="11" x2="12" y2="17"></line>
                                        <line x1="9" y1="14" x2="15" y2="14"></line>
                                    </svg>
                                </span>
                                {t('hostTree.contextMenu.addFolder')}
                            </button>
                            <button onClick={() => openAddHost(contextMenu.node?.id ?? null)}>
                                <span className="menu-icon-wrapper">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-host)' }}>
                                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                                        <line x1="12" y1="6" x2="12" y2="14"></line>
                                        <line x1="8" y1="10" x2="16" y2="10"></line>
                                        <line x1="8" y1="21" x2="16" y2="21"></line>
                                        <line x1="12" y1="17" x2="12" y2="21"></line>
                                    </svg>
                                </span>
                                {t('hostTree.contextMenu.addHost')}
                            </button>
                        </>
                    )}
                    {contextMenu.node && (
                        <>
                            {contextMenu.node.type === 'folder' && <div className="context-menu-separator" />}
                            {contextMenu.node && (
                                <button
                                    onClick={() => {
                                        setEditingNodeId(contextMenu.node!.id);
                                        setEditingName(contextMenu.node!.name);
                                        setContextMenu(null);
                                    }}
                                >
                                    <span className="menu-icon-wrapper">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-warning)' }}>
                                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                                        </svg>
                                    </span>
                                    {t('hostTree.contextMenu.rename')}
                                </button>
                            )}
                            <button
                                onClick={() => handleExport(contextMenu.node)}
                            >
                                <span className="menu-icon-wrapper">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-danger)' }}>
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="17 8 12 3 7 8"></polyline>
                                        <line x1="12" y1="3" x2="12" y2="15"></line>
                                    </svg>
                                </span>
                                {t('hostTree.contextMenu.export')}
                            </button>
                            {contextMenu.node?.type === 'folder' && (
                                <button
                                    onClick={() => handleImport(contextMenu.node!.id)}
                                >
                                    <span className="menu-icon-wrapper">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--success-color)' }}>
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                            <polyline points="7 10 12 15 17 10"></polyline>
                                            <line x1="12" y1="15" x2="12" y2="3"></line>
                                        </svg>
                                    </span>
                                    {t('hostTree.contextMenu.import')}
                                </button>
                            )}
                            {contextMenu.node.type === 'folder' && onSortFolder && (
                                <button
                                    onClick={() => {
                                        onSortFolder(contextMenu.node?.id ?? null);
                                        setContextMenu(null);
                                    }}
                                >
                                    <span className="menu-icon-wrapper">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-host)' }}>
                                            <path d="M18 15l-6-6-6 6"></path>
                                        </svg>
                                    </span>
                                    {t('hostTree.contextMenu.sortAscending')}
                                </button>
                            )}
                            <button
                                className="danger"
                                onClick={() => {
                                    openNodeToDelete(contextMenu.node!);
                                    setContextMenu(null);
                                }}
                            >
                                <span className="menu-icon-wrapper">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-danger)' }}>
                                        <polyline points="3 6 5 6 21 6"></polyline>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                        <line x1="10" y1="11" x2="10" y2="17"></line>
                                        <line x1="14" y1="11" x2="14" y2="17"></line>
                                    </svg>
                                </span>
                                {t('common.delete')}
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Add/Edit/Export/Import Modal */}
            {editModalOpen && editModal && (
                <div className="host-edit-modal-overlay" onClick={closeEditModal} tabIndex={-1}>
                    <div
                        className="host-edit-modal"
                        ref={editModalRef}
                        onClick={(e) => e.stopPropagation()}
                        onContextMenu={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                closeEditModal();
                            }
                        }}
                    >
                        <h3>
                            {editModal.mode === 'folder' ? (editModal.existingNode ? t('hostTree.modal.renameFolder') : t('hostTree.modal.addFolder')) :
                                editModal.mode === 'host' ? (editModal.existingNode ? t('hostTree.modal.editHost') : t('hostTree.modal.addHost')) :
                                    editModal.mode === 'export' ? t('hostTree.modal.exportTitle') : t('hostTree.modal.importTitle')}
                        </h3>

                        {editModal.mode !== 'export' && editModal.mode !== 'import' && (
                            <div className="modal-form-group">
                                <label>{t('hostTree.modal.displayName')}</label>
                                <input
                                    ref={modalInputRef}
                                    autoFocus
                                    type="text"
                                    value={formName}
                                    onChange={e => setFormName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                />
                            </div>
                        )}

                        {(editModal.mode === 'export' || editModal.mode === 'import') && (
                            <div className="modal-form-group">
                                <label>
                                    {editModal.mode === 'export' ? t('hostTree.modal.setEncryptionPassword') : t('hostTree.modal.enterDecryptionPassword')}
                                </label>
                                <input
                                    ref={modalInputRef}
                                    autoFocus
                                    type="password"
                                    value={formPassword}
                                    onChange={e => setFormPassword(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                    autoComplete="new-password"
                                />
                                <p style={{ fontSize: 'calc(var(--font-size-base) - 4px)', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    {editModal.mode === 'export'
                                        ? t('hostTree.modal.exportPasswordHint')
                                        : t('hostTree.modal.importPasswordHint')}
                                </p>
                            </div>
                        )}

                        {editModal.mode === 'host' && (
                            <>
                                <div className="modal-form-group">
                                    <label>{t('hostTree.modal.protocol')}</label>
                                    <select
                                        value={formProtocol}
                                        onChange={e => {
                                            const p = e.target.value as 'ssh' | 'telnet';
                                            setFormProtocol(p);
                                            if (p === 'ssh') setFormPort('22');
                                            else if (p === 'telnet') setFormPort('23');
                                            if (p !== 'ssh') setFormIsJumpbox(false);
                                        }}
                                    >
                                        <option value="ssh">SSH</option>
                                        <option value="telnet">Telnet</option>
                                    </select>
                                </div>
                                {formProtocol === 'ssh' && (
                                    <div className="modal-form-group modal-form-group-checkbox">
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={formIsJumpbox}
                                                onChange={e => setFormIsJumpbox(e.target.checked)}
                                            />
                                            {t('hostTree.modal.useAsJumpbox')}
                                        </label>
                                    </div>
                                )}
                                {(formProtocol === 'ssh' || formProtocol === 'telnet') && (
                                    <>
                                        <div className="modal-form-row">
                                            <div className="modal-form-group flex-3">
                                                <label>{t('hostTree.modal.hostLabel')}</label>
                                                <input
                                                    type="text"
                                                    value={formHost}
                                                    onChange={e => setFormHost(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                    placeholder={t('hostTree.modal.hostPlaceholder')}
                                                />
                                            </div>
                                            <div className="modal-form-group flex-1">
                                                <label>{t('hostTree.modal.portLabel')}</label>
                                                <input
                                                    type="number"
                                                    value={formPort}
                                                    onChange={e => setFormPort(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                />
                                            </div>
                                        </div>
                                        <div className="modal-form-group">
                                            <label>{t('hostTree.modal.usernameLabel')}</label>
                                            <input
                                                type="text"
                                                value={formUsername}
                                                onChange={e => setFormUsername(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                autoComplete="off"
                                            />
                                        </div>
                                        <div className="modal-form-group">
                                            <label>{t('hostTree.modal.passwordLabel')}</label>
                                            <input
                                                type="password"
                                                value={formPassword}
                                                onChange={e => setFormPassword(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                autoComplete="new-password"
                                            />
                                        </div>
                                    </>
                                )}
                            </>
                        )}

                        <div className="modal-actions">
                            <button className="btn-secondary" onClick={closeEditModal}>{t('common.cancel')}</button>
                            <button className="btn-primary" onClick={handleModalSubmit}>
                                {editModal.mode === 'export' ? t('hostTree.modal.export') :
                                    editModal.mode === 'import' ? t('hostTree.modal.import') : t('common.save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {nodeToDeleteOpen && nodeToDelete && (() => {
                const jumpboxRefs = nodeToDelete.type === 'host' && nodeToDelete.entry?.isJumpbox
                    ? getJumpboxReferences(tree, nodeToDelete.id)
                    : [];
                const refWarning = jumpboxRefs.length > 0
                    ? t('hostTree.delete.jumpboxWarning', { count: jumpboxRefs.length, names: jumpboxRefs.map(r => r.name).join(', ') })
                    : '';
                return (
                <ConfirmModal
                    title={nodeToDelete.type === 'folder' ? t('hostTree.delete.titleFolder') : t('hostTree.delete.titleHost')}
                    message={t('hostTree.delete.message', { name: nodeToDelete.name, warning: refWarning })}
                    onConfirm={() => {
                        for (const ref of jumpboxRefs) {
                            onEditNode(ref.id, { entry: { ...ref.entry!, jumpboxId: undefined } });
                        }
                        onDeleteNode(nodeToDelete.id);
                        closeNodeToDelete();
                    }}
                    onCancel={() => {
                        closeNodeToDelete();
                    }}
                />
                );
            })()}
        </div>
    );
};
