import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useHostManager } from '../../hooks/useHostManager';
import { buildHostEntryFromConfig } from './buildHostEntry';
import type { HostTreeNode, ProtocolId } from '../../types/appTypes';
import type { AnyConfig } from '../../hooks/useSessionManager';
import './SaveToHostTreeDialog.css';

interface SaveToHostTreeDialogProps {
    open: boolean;
    initialName: string;
    protocol: ProtocolId | null;
    config: AnyConfig | undefined;
    onClose: () => void;
}

interface FolderRow {
    id: string | null;
    name: string;
    depth: number;
}

function flattenFolders(nodes: HostTreeNode[], depth: number = 0): FolderRow[] {
    const result: FolderRow[] = [];
    for (const n of nodes) {
        if (n.type === 'folder') {
            result.push({ id: n.id, name: n.name, depth });
            if (n.children) {
                result.push(...flattenFolders(n.children, depth + 1));
            }
        }
    }
    return result;
}

export const SaveToHostTreeDialog: React.FC<SaveToHostTreeDialogProps> = ({
    open,
    initialName,
    protocol,
    config,
    onClose,
}) => {
    const { t } = useTranslation();
    const hostManager = useHostManager();
    const [name, setName] = useState(initialName);
    const [parentId, setParentId] = useState<string | null>(null);
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const nameInputRef = useRef<HTMLInputElement>(null);
    const newFolderInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            /* eslint-disable react-hooks/set-state-in-effect */
            setName(initialName);
            setParentId(null);
            setCreatingFolder(false);
            setNewFolderName('');
            /* eslint-enable react-hooks/set-state-in-effect */
        }
    }, [open, initialName]);

    useEffect(() => {
        if (creatingFolder) {
            newFolderInputRef.current?.focus();
        }
    }, [creatingFolder]);

    const folderRows = useMemo<FolderRow[]>(
        () => [{ id: null, name: t('dialogs.saveToHostTree.rootFolder'), depth: 0 }, ...flattenFolders(hostManager.tree)],
        [hostManager.tree, t],
    );

    const entry = useMemo(() => buildHostEntryFromConfig(protocol, config), [protocol, config]);

    const canSave = name.trim().length > 0 && entry !== null;
    const canCreateFolder = newFolderName.trim().length > 0;

    const handleSave = () => {
        const trimmed = name.trim();
        if (!trimmed || !entry) return;
        hostManager.addHost(parentId, trimmed, entry);
        onClose();
    };

    const handleNewFolderClick = () => {
        setNewFolderName('');
        setCreatingFolder(true);
    };

    const handleCreateFolder = () => {
        const trimmed = newFolderName.trim();
        if (!trimmed) return;
        const newId = hostManager.addFolder(parentId, trimmed);
        setParentId(newId);
        setNewFolderName('');
        setCreatingFolder(false);
    };

    const handleCancelCreateFolder = () => {
        setNewFolderName('');
        setCreatingFolder(false);
    };

    if (!open) return null;

    return (
        <div className="save-to-tree-overlay" onClick={onClose}>
            <div
                className="save-to-tree-modal"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        onClose();
                    }
                }}
            >
                <h3>{t('dialogs.saveToHostTree.title')}</h3>
                {entry === null ? (
                    <p className="save-to-tree-error">
                        {t('dialogs.saveToHostTree.unsupported')}
                    </p>
                ) : (
                    <>
                        <div className="modal-form-group">
                            <label>{t('dialogs.saveToHostTree.nameLabel')}</label>
                            <input
                                ref={nameInputRef}
                                autoFocus
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleSave();
                                    }
                                }}
                            />
                        </div>
                        <div className="modal-form-group">
                            <label>{t('dialogs.saveToHostTree.folderLabel')}</label>
                            <div className="save-to-tree-folder-list" role="listbox">
                                {folderRows.map((row) => {
                                    const isSelected = row.id === parentId;
                                    const showInlineInput = creatingFolder && isSelected;
                                    return (
                                        <React.Fragment key={row.id ?? '__root__'}>
                                            <div
                                                role="option"
                                                aria-selected={isSelected}
                                                className={`save-to-tree-folder-row${isSelected ? ' selected' : ''}`}
                                                style={{ paddingLeft: `${8 + row.depth * 16}px` }}
                                                onClick={() => setParentId(row.id)}
                                            >
                                                <span className="save-to-tree-folder-icon" aria-hidden>📁</span>
                                                <span className="save-to-tree-folder-name">{row.name}</span>
                                            </div>
                                            {showInlineInput && (
                                                <div
                                                    className="save-to-tree-inline-input-row"
                                                    style={{ paddingLeft: `${8 + (row.depth + 1) * 16}px` }}
                                                >
                                                    <input
                                                        ref={newFolderInputRef}
                                                        type="text"
                                                        placeholder={t('dialogs.saveToHostTree.newFolderPlaceholder')}
                                                        value={newFolderName}
                                                        onChange={(e) => setNewFolderName(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            e.stopPropagation();
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                handleCreateFolder();
                                                            } else if (e.key === 'Escape') {
                                                                e.preventDefault();
                                                                handleCancelCreateFolder();
                                                            }
                                                        }}
                                                    />
                                                    <button
                                                        className="btn-primary"
                                                        onClick={handleCreateFolder}
                                                        disabled={!canCreateFolder}
                                                    >
                                                        {t('dialogs.saveToHostTree.create')}
                                                    </button>
                                                    <button
                                                        className="btn-secondary"
                                                        onClick={handleCancelCreateFolder}
                                                    >
                                                        {t('common.cancel')}
                                                    </button>
                                                </div>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                            <button
                                className="save-to-tree-new-folder-btn"
                                onClick={handleNewFolderClick}
                                disabled={creatingFolder}
                            >
                                {t('dialogs.saveToHostTree.newFolder')}
                            </button>
                        </div>
                    </>
                )}
                <div className="modal-actions">
                    <button className="btn-secondary" onClick={onClose}>
                        {t('common.cancel')}
                    </button>
                    {entry !== null && (
                        <button className="btn-primary" onClick={handleSave} disabled={!canSave}>
                            {t('common.save')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
