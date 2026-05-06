import React from 'react';
import type { ChatTab } from '../../hooks/useAiChat';
import './TabStrip.css';

interface TabStripProps {
    tabs: ChatTab[];
    activeTabId: string;
    onSelect: (tabId: string) => void;
    onClose: (tabId: string) => void;
    onAdd: () => void;
}

export const TabStrip: React.FC<TabStripProps> = ({ tabs, activeTabId, onSelect, onClose, onAdd }) => {
    const canClose = tabs.length > 1;
    return (
        <div className="ai-chat-tab-strip" role="tablist" aria-label="AI Chat tabs">
            <div className="ai-chat-tab-strip-list">
                {tabs.map((tab) => {
                    const active = tab.id === activeTabId;
                    return (
                        <div
                            key={tab.id}
                            role="tab"
                            aria-selected={active}
                            tabIndex={active ? 0 : -1}
                            className={`ai-chat-tab${active ? ' active' : ''}`}
                            onClick={() => onSelect(tab.id)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onSelect(tab.id);
                                }
                            }}
                            title={tab.title}
                        >
                            <span className="ai-chat-tab-title">{tab.title}</span>
                            {canClose && (
                                <button
                                    type="button"
                                    className="ai-chat-tab-close"
                                    aria-label={`Close ${tab.title}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onClose(tab.id);
                                    }}
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
            <button
                type="button"
                className="ai-chat-tab-add"
                aria-label="Add tab"
                title="Add tab"
                onClick={onAdd}
            >
                +
            </button>
        </div>
    );
};
