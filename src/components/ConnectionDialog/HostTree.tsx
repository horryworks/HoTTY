import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { HostTreeNode, HostEntry } from '../../hooks/useHostManager';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import './HostTree.css';

interface ContextMenuState {
    x: number;
    y: number;
    node: HostTreeNode | null;
}

interface EditModalState {
    mode: 'folder' | 'host';
    parentId: string | null;
    existingNode?: HostTreeNode;
}

interface HostTreeProps {
    tree: HostTreeNode[];
    selectedId: string | null;
    onSelect: (node: HostTreeNode) => void;
    onDoubleClickHost?: (node: HostTreeNode) => void;
    onAddFolder: (parentId: string | null, name: string) => void;
    onAddHost: (parentId: string | null, name: string, entry: HostEntry) => void;
    onEditNode: (id: string, patch: Partial<HostTreeNode>) => void;
    onDeleteNode: (id: string) => void;
    onMoveNode?: (nodeId: string, targetId: string, position: 'before' | 'after' | 'inside') => void;
    onSortFolder?: (folderId: string | null) => void;
}

export const HostTree: React.FC<HostTreeProps> = ({
    tree,
    selectedId,
    onSelect,
    onDoubleClickHost,
    onAddFolder,
    onAddHost,
    onEditNode,
    onDeleteNode,
    onMoveNode,
    onSortFolder,
}) => {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [editModal, setEditModal] = useState<EditModalState | null>(null);

    // Inline edit state
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');

    const [formName, setFormName] = useState('');
    const [formProtocol, setFormProtocol] = useState<'ssh' | 'telnet'>('ssh');
    const [formHost, setFormHost] = useState('');
    const [formPort, setFormPort] = useState('22');
    const [formUsername, setFormUsername] = useState('');
    const [formPassword, setFormPassword] = useState('');
    const [isDecrypting] = useState(false);
    const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<{ nodeId: string; position: 'before' | 'after' | 'inside' } | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const editModalRef = useRef<HTMLDivElement>(null);

    // Focus trap for the edit modal
    useFocusTrap(editModalRef, !!editModal);

    // Close context menu on outside click
    useEffect(() => {
        const handler = () => setContextMenu(null);
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, []);

    // Close edit modal on Escape
    useEffect(() => {
        if (!editModal) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setEditModal(null);
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [editModal]);

    const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

    const openContextMenu = useCallback((e: React.MouseEvent, node: HostTreeNode | null) => {
        e.preventDefault();
        e.stopPropagation();
        // Compute position relative to the container to avoid transform-parent issue
        const rect = containerRef.current?.getBoundingClientRect();
        const x = rect ? e.clientX - rect.left : e.clientX;
        const y = rect ? e.clientY - rect.top : e.clientY;
        setContextMenu({ x, y, node });
    }, []);

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

    const openAddFolder = useCallback((parentId: string | null) => {
        setFormName('');
        setEditModal({ mode: 'folder', parentId });
        setContextMenu(null);
    }, []);

    const openAddHost = useCallback((parentId: string | null) => {
        setFormName('');
        setFormProtocol('ssh');
        setFormHost('');
        setFormPort('22');
        setFormUsername('');
        setFormPassword('');
        setEditModal({ mode: 'host', parentId });
        setContextMenu(null);
    }, []);



    const handleModalSubmit = () => {
        if (!editModal) return;
        const { mode, parentId, existingNode } = editModal;

        if (existingNode) {
            if (mode === 'folder') {
                onEditNode(existingNode.id, { name: formName });
            } else {
                const entry: HostEntry = {
                    protocol: formProtocol,
                    host: formHost,
                    port: parseInt(formPort),
                    username: formUsername || undefined,
                    password: formPassword || undefined,
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
                    port: parseInt(formPort),
                    username: formUsername || undefined,
                    password: formPassword || undefined,
                };
                onAddHost(parentId, formName, entry);
            }
        }
        setEditModal(null);
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
                            // If folder is expanded and has children, dropping at the bottom of the header means 'inside' 
                            // rather than 'after' (since children are in between).
                            if (isNodeExpanded && node.children && node.children.length > 0) {
                                if (y < h * 0.25) position = 'before';
                                else position = 'inside';
                            } else {
                                if (y < h * 0.25) position = 'before';
                                else if (y > h * 0.75) position = 'after';
                                else position = 'inside';
                            }
                        } else {
                            // Host: top 50% = before, bottom 50% = after
                            position = y < h * 0.5 ? 'before' : 'after';
                        }
                        setDropTarget({ nodeId: node.id, position });
                    }}
                    onDragLeave={(e) => {
                        // Only clear if leaving the element entirely
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

                        // Calculate drop position synchronously to avoid React state closure staleness
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
                        // Application key or Shift+F10 → open context menu at element
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
                            <span className="tree-icon">{isExpanded ? '▾' : '▸'}</span>
                            <span className="tree-icon">📁</span>
                        </>
                    ) : (
                        <>
                            <span className="tree-icon" style={{ opacity: 0 }}>▸</span>
                            <span className="tree-icon">🖥</span>
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
                                    e.stopPropagation(); // prevent tree row from handling it
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
                                    <span className="tree-meta"> {node.entry.host}</span>
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
                    title="Add Folder"
                    onClick={() => openAddFolder(getTargetParentId())}
                    style={{ cursor: 'pointer' }}
                >📁+</div>
                <div
                    className="tree-toolbar-btn"
                    role="button"
                    title="Add Host"
                    onClick={() => openAddHost(getTargetParentId())}
                    style={{ cursor: 'pointer' }}
                >🖥+</div>
            </div>

            {/* Tree */}
            <div className="host-tree-body">
                {tree.length === 0 && (
                    <div className="host-tree-empty">Right-click or use the + buttons above to add hosts and folders</div>
                )}
                {tree.map(node => renderNode(node, 0))}
            </div>

            {/* Context Menu — position absolute relative to container to avoid transform-parent issue */}
            {contextMenu && (
                <div
                    className="context-menu"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {contextMenu.node?.type !== 'host' && (
                        <>
                            <button onClick={() => openAddFolder(contextMenu.node?.id ?? null)}>
                                📁 Add Folder
                            </button>
                            <button onClick={() => openAddHost(contextMenu.node?.id ?? null)}>
                                🖥 Add Host
                            </button>
                        </>
                    )}
                    {contextMenu.node && (
                        <>
                            <div className="context-menu-separator" />
                            {contextMenu.node && (
                                <button
                                    onClick={() => {
                                        setEditingNodeId(contextMenu.node!.id);
                                        setEditingName(contextMenu.node!.name);
                                        setContextMenu(null);
                                    }}
                                >
                                    ✏️ Rename (F2)
                                </button>
                            )}
                            {contextMenu.node.type === 'folder' && onSortFolder && (
                                <button
                                    onClick={() => {
                                        onSortFolder(contextMenu.node?.id ?? null);
                                        setContextMenu(null);
                                    }}
                                >
                                    🔼 Sort Ascending
                                </button>
                            )}
                            <button
                                className="danger"
                                onClick={() => {
                                    onDeleteNode(contextMenu.node!.id);
                                    setContextMenu(null);
                                }}
                            >
                                🗑 Delete
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Add/Edit Modal */}
            {editModal && (
                <div className="host-edit-modal-overlay" onClick={() => setEditModal(null)}>
                    <div className="host-edit-modal" ref={editModalRef} onClick={e => e.stopPropagation()}>
                        <h3 style={{ marginTop: 0 }}>
                            {editModal.existingNode ? 'Edit' : editModal.mode === 'folder' ? 'Add Folder' : 'Add Host'}
                        </h3>

                        <div className="modal-form-group">
                            <label>Display Name</label>
                            <input
                                autoFocus
                                type="text"
                                value={formName}
                                onChange={e => setFormName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                            />
                        </div>

                        {editModal.mode === 'host' && (
                            <>
                                <div className="modal-form-group">
                                    <label>Protocol</label>
                                    <select
                                        value={formProtocol}
                                        onChange={e => {
                                            const p = e.target.value as 'ssh' | 'telnet';
                                            setFormProtocol(p);
                                            setFormPort(p === 'ssh' ? '22' : '23');
                                        }}
                                    >
                                        <option value="ssh">SSH</option>
                                        <option value="telnet">Telnet</option>
                                    </select>
                                </div>
                                <div className="modal-form-row">
                                    <div className="modal-form-group flex-3">
                                        <label>Host / IP</label>
                                        <input
                                            type="text"
                                            value={formHost}
                                            onChange={e => setFormHost(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                            placeholder="192.168.1.1"
                                        />
                                    </div>
                                    <div className="modal-form-group flex-1">
                                        <label>Port</label>
                                        <input
                                            type="number"
                                            value={formPort}
                                            onChange={e => setFormPort(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                        />
                                    </div>
                                </div>
                                {formProtocol === 'ssh' && (
                                    <>
                                        <div className="modal-form-group">
                                            <label>Username</label>
                                            <input
                                                type="text"
                                                value={isDecrypting ? 'Decrypting...' : formUsername}
                                                onChange={e => setFormUsername(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                className={isDecrypting ? 'decrypting-placeholder' : ''}
                                                disabled={isDecrypting}
                                                autoComplete="off"
                                            />
                                        </div>
                                        <div className="modal-form-group">
                                            <label>Password</label>
                                            <input
                                                type="password"
                                                value={isDecrypting ? 'Decrypting...' : formPassword}
                                                onChange={e => setFormPassword(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                className={isDecrypting ? 'decrypting-placeholder' : ''}
                                                disabled={isDecrypting}
                                                autoComplete="new-password"
                                            />
                                        </div>
                                    </>
                                )}
                            </>
                        )}

                        <div className="modal-actions">
                            <button className="btn-secondary" onClick={() => setEditModal(null)}>Cancel</button>
                            <button className="btn-primary" onClick={handleModalSubmit}>Save</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
