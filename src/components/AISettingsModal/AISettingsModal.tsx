import React, { useEffect, useRef } from 'react';
import { useDraggable } from '../../hooks/useDraggable';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { AISettingsTab } from '../SettingsModal/AISettingsTab';
import * as electronService from '../../services/electronService';
import type { PersonaDefinition } from '../../types/appTypes';
import './AISettingsModal.css';

interface AISettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onLogout: () => void;
    showSystemPrompt: boolean;
    onShowSystemPromptChange: (show: boolean) => void;
    aiPersonas: PersonaDefinition[];
    onAiPersonasChange: (personas: PersonaDefinition[]) => void;
    activePersonaId: string;
    onActivePersonaIdChange: (id: string) => void;
    watchBufferLimit: number;
    onWatchBufferLimitChange: (limit: number) => void;
    proactiveInstruction: string;
    onProactiveInstructionChange: (instruction: string) => void;
    interactiveStabilizationTimeout: number;
    onInteractiveStabilizationTimeoutChange: (timeout: number) => void;
}

export const AISettingsModal: React.FC<AISettingsModalProps> = ({
    isOpen,
    onClose,
    onLogout,
    showSystemPrompt,
    onShowSystemPromptChange,
    aiPersonas,
    onAiPersonasChange,
    activePersonaId,
    onActivePersonaIdChange,
    watchBufferLimit,
    onWatchBufferLimitChange,
    proactiveInstruction,
    onProactiveInstructionChange,
    interactiveStabilizationTimeout,
    onInteractiveStabilizationTimeoutChange,
}) => {
    const { position, onMouseDown: onHeaderMouseDown } = useDraggable();
    const [isAiAuthenticated, setIsAiAuthenticated] = React.useState<boolean>(false);
    const modalRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    useFocusTrap(modalRef, isOpen);

    useEffect(() => {
        if (isOpen && closeButtonRef.current) {
            closeButtonRef.current.focus();
        }
    }, [isOpen]);

    React.useEffect(() => {
        if (isOpen) {
            electronService.aiAuthStatus().then(setIsAiAuthenticated);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // ── Drag and Drop for Commands ──
    const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
        e.preventDefault();
        const activePersona = aiPersonas.find(p => p.id === activePersonaId) ?? aiPersonas[0];
        if (draggedIndex === null || draggedIndex === dropIndex || !activePersona) return;

        const newCommands = [...activePersona.askAiCommands];
        const [movedItem] = newCommands.splice(draggedIndex, 1);
        newCommands.splice(dropIndex, 0, movedItem);

        const newPersonas = aiPersonas.map(p =>
            p.id === activePersona.id ? { ...p, askAiCommands: newCommands } : p
        );
        onAiPersonasChange(newPersonas);
        setDraggedIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
    };

    if (!isOpen) return null;

    return (
        <div className="ai-settings-modal-overlay">
            <div className="ai-settings-modal" ref={modalRef} style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
                <div className="ai-settings-header" onMouseDown={onHeaderMouseDown}>
                    <h2>AI Settings</h2>
                    <button className="close-btn" ref={closeButtonRef} onClick={onClose}>✕</button>
                </div>

                <div className="ai-settings-content">
                    <AISettingsTab
                        isAiAuthenticated={isAiAuthenticated}
                        onAuthenticatedChange={setIsAiAuthenticated}
                        onLogout={onLogout}
                        watchBufferLimit={watchBufferLimit}
                        onWatchBufferLimitChange={onWatchBufferLimitChange}
                        interactiveStabilizationTimeout={interactiveStabilizationTimeout}
                        onInteractiveStabilizationTimeoutChange={onInteractiveStabilizationTimeoutChange}
                        aiPersonas={aiPersonas}
                        onAiPersonasChange={onAiPersonasChange}
                        activePersonaId={activePersonaId}
                        onActivePersonaIdChange={onActivePersonaIdChange}
                        proactiveInstruction={proactiveInstruction}
                        onProactiveInstructionChange={onProactiveInstructionChange}
                        showSystemPrompt={showSystemPrompt}
                        onShowSystemPromptChange={onShowSystemPromptChange}
                        draggedIndex={draggedIndex}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                    />
                </div>
            </div>
        </div>
    );
};
