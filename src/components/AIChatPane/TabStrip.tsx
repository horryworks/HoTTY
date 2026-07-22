import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatTab } from '../../hooks/useAiChat';
import { conversationColorIndex, conversationColorVar } from '../../utils/conversationColor';
import './TabStrip.css';

interface TabStripProps {
    tabs: ChatTab[];
    activeTabId: string;
    onSelect: (tabId: string) => void;
    onClose: (tabId: string) => void;
    onAdd: () => void;
    /** Tabs with an in-flight AI response — shown with a spinner so a background
     *  conversation streaming in parallel is visible without switching to it. */
    streamingTabIds?: Set<string>;
}

export const TabStrip: React.FC<TabStripProps> = ({ tabs, activeTabId, onSelect, onClose, onAdd, streamingTabIds }) => {
    const { t } = useTranslation();
    return (
        <div className="ai-chat-tab-strip" role="tablist" aria-label={t('aiChat.tabStrip.ariaLabel')}>
            <div className="ai-chat-tab-strip-list">
                {tabs.map((tab) => {
                    const active = tab.id === activeTabId;
                    const streaming = streamingTabIds?.has(tab.id) ?? false;
                    // Empty title (unlinked/unnamed tab) => localized "Tab N" fallback.
                    const displayTitle = tab.title || t('aiChat.tabStrip.tabN', { n: tab.ordinal });
                    // Per-conversation color (matches its watched terminal tabs & chips).
                    const convColor = conversationColorVar(conversationColorIndex(tab.ordinal));
                    return (
                        <div
                            key={tab.id}
                            role="tab"
                            aria-selected={active}
                            aria-busy={streaming}
                            tabIndex={active ? 0 : -1}
                            className={`ai-chat-tab${active ? ' active' : ''}${streaming ? ' streaming' : ''}`}
                            style={{ '--conv-color': convColor } as React.CSSProperties}
                            onClick={() => onSelect(tab.id)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onSelect(tab.id);
                                }
                            }}
                            title={streaming ? t('aiChat.tabStrip.tabStreaming', { title: displayTitle }) : displayTitle}
                        >
                            {streaming
                                ? <span className="ai-chat-tab-spinner" aria-hidden="true" />
                                : <span className="ai-chat-tab-dot" aria-hidden="true" />}
                            <span className="ai-chat-tab-title">{displayTitle}</span>
                            {/* Always closeable. Closing the last tab closes the whole
                                pane (handled by the parent's onClose). */}
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
                        </div>
                    );
                })}
                {/* The + sits immediately to the right of the last tab (left-aligned)
                    and scrolls with the list. */}
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
        </div>
    );
};
