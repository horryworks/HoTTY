import React from 'react';
import { useTranslation } from 'react-i18next';
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
    const { t } = useTranslation();
    const canClose = tabs.length > 1;
    return (
        <div className="ai-chat-tab-strip" role="tablist" aria-label={t('aiChat.tabStrip.ariaLabel')}>
            <div className="ai-chat-tab-strip-list">
                {tabs.map((tab) => {
                    const active = tab.id === activeTabId;
                    // Empty title (unlinked/unnamed tab) => localized "Tab N" fallback.
                    const displayTitle = tab.title || t('aiChat.tabStrip.tabN', { n: tab.ordinal });
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
                            title={displayTitle}
                        >
                            <span className="ai-chat-tab-title">{displayTitle}</span>
                            {canClose && (
                                <button
                                    type="button"
                                    className="ai-chat-tab-close"
                                    aria-label={t('aiChat.tabStrip.closeTab', { title: displayTitle })}
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
                aria-label={t('aiChat.tabStrip.addTab')}
                title={t('aiChat.tabStrip.addTab')}
                onClick={onAdd}
            >
                +
            </button>
        </div>
    );
};
