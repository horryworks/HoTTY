import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import type { Theme, ThemeTerminalColors } from '../../types/appTypes';
import { nameToKey } from './nameToKey';
import './CustomThemeCreator.css';

interface CustomThemeCreatorProps {
    isOpen: boolean;
    themesData: Record<string, Theme>;
    currentTheme: string;
    onSave: (themeKey: string) => void;
    onCancel: () => void;
}

const PROTECTED_THEMES = ['dark', 'medium', 'light'];

// Section title/description are referenced by translation key and resolved via
// t() inside the component; the CSS-variable `keys` list is data, not display text.
const THEME_SECTIONS: { titleKey: string; descKey: string; keys: string[] }[] = [
    {
        titleKey: 'settings.customTheme.sectionBackgroundsTitle',
        descKey: 'settings.customTheme.sectionBackgroundsDesc',
        keys: ['bg-primary', 'bg-secondary', 'bg-tertiary', 'text-primary', 'text-secondary', 'text-tertiary', 'text-on-accent'],
    },
    {
        titleKey: 'settings.customTheme.sectionBordersTitle',
        descKey: 'settings.customTheme.sectionBordersDesc',
        keys: ['border-color', 'accent-color', 'accent-hover', 'accent-light', 'accent-secondary', 'link-color'],
    },
    {
        titleKey: 'settings.customTheme.sectionInputsTitle',
        descKey: 'settings.customTheme.sectionInputsDesc',
        keys: ['input-bg', 'btn-bg', 'btn-hover-bg', 'btn-secondary-bg', 'btn-secondary-hover-bg', 'btn-danger-bg', 'btn-danger-hover-bg', 'hover-bg', 'placeholder-color'],
    },
    {
        titleKey: 'settings.customTheme.sectionStatusTitle',
        descKey: 'settings.customTheme.sectionStatusDesc',
        keys: ['success-color', 'status-success', 'status-error', 'color-danger', 'color-danger-shade', 'color-danger-bg', 'color-danger-bg-hover', 'color-danger-border', 'color-warning'],
    },
    {
        titleKey: 'settings.customTheme.sectionAiChatTitle',
        descKey: 'settings.customTheme.sectionAiChatDesc',
        keys: ['chat-msg-user-bg', 'chat-msg-user-text', 'chat-msg-model-text', 'code-bg', 'code-text', 'ai-header-bg', 'ai-welcome-text', 'ai-welcome-subtext', 'ai-chat-content-font-size', 'ai-token-font-size', 'ai-markdown-h1-font-size', 'ai-markdown-h2-font-size', 'ai-markdown-h3-font-size', 'ai-markdown-table-font-size'],
    },
    {
        titleKey: 'settings.customTheme.sectionUiTitle',
        descKey: 'settings.customTheme.sectionUiDesc',
        keys: ['sidebar-bg', 'sidebar-btn-color', 'sidebar-btn-hover-bg', 'sidebar-btn-hover-color', 'sidebar-btn-active-bg', 'tab-bg', 'tab-text', 'tab-active-text', 'tab-close-bg', 'tab-close-hover-bg', 'tab-watching-text', 'tab-watching-bg', 'tab-watching-icon', 'tab-watching-icon-glow', 'tab-connecting-bg', 'tab-connecting-text', 'pane-connecting-bg', 'context-menu-bg', 'context-menu-border', 'context-menu-text', 'context-menu-hover-bg', 'hidden-item-bg', 'hidden-item-bg-hover', 'tree-meta-color', 'icon-folder', 'icon-host', 'terminal-prompt-default', 'terminal-prompt-active', 'terminal-letterbox-bg', 'pane-color-1', 'pane-color-2', 'pane-color-3', 'pane-color-4', 'pane-color-5', 'pane-color-6', 'resize-grip-shadow'],
    },
    {
        titleKey: 'settings.customTheme.sectionProvidersTitle',
        descKey: 'settings.customTheme.sectionProvidersDesc',
        keys: ['provider-gemini-1', 'provider-gemini-2', 'provider-gemini-3', 'provider-openai', 'provider-anthropic', 'provider-vertex-ai'],
    },
    {
        titleKey: 'settings.customTheme.sectionSearchTitle',
        descKey: 'settings.customTheme.sectionSearchDesc',
        keys: ['search-highlight-bg', 'search-highlight-current-bg', 'search-highlight-current-border', 'search-highlight-mark-bg', 'search-highlight-mark-solid', 'search-highlight-mark-text'],
    },
    {
        titleKey: 'settings.customTheme.sectionOverlaysTitle',
        descKey: 'settings.customTheme.sectionOverlaysDesc',
        keys: ['modal-overlay-bg', 'modal-shadow', 'modal-border-warning', 'modal-header-warning-bg', 'modal-header-warning-text', 'modal-border-error', 'modal-header-error-bg', 'modal-header-error-text', 'modal-border-success', 'modal-header-success-bg', 'modal-header-success-text', 'modal-header-info-bg', 'modal-header-info-border', 'modal-header-info-text', 'update-notification-bg', 'update-notification-border', 'update-notification-text', 'update-notification-accent', 'update-notification-btn-bg', 'update-notification-btn-text', 'update-notification-btn-border', 'update-notification-btn-hover'],
    },
    {
        titleKey: 'settings.customTheme.sectionEffectsTitle',
        descKey: 'settings.customTheme.sectionEffectsDesc',
        keys: ['glow-accent', 'glow-accent-strong', 'glow-blur', 'glass-bg', 'glass-blur', 'glass-border', 'icon-stroke-width'],
    },
];

const TERMINAL_KEYS: { key: keyof ThemeTerminalColors; labelKey: string; descKey: string }[] = [
    { key: 'foreground', labelKey: 'settings.customTheme.terminalForeground', descKey: 'settings.customTheme.terminalForegroundDesc' },
    { key: 'background', labelKey: 'settings.customTheme.terminalBackground', descKey: 'settings.customTheme.terminalBackgroundDesc' },
    { key: 'backgroundInactive', labelKey: 'settings.customTheme.terminalBackgroundInactive', descKey: 'settings.customTheme.terminalBackgroundInactiveDesc' },
    { key: 'paneBackground', labelKey: 'settings.customTheme.terminalPaneBackground', descKey: 'settings.customTheme.terminalPaneBackgroundDesc' },
];

/** Translation key for each themeable CSS variable's tooltip. Keys, not
 *  literals: this map is rendered as user-facing `title` text, and the rest of
 *  this file (THEME_SECTIONS, TERMINAL_KEYS) already stores keys resolved with
 *  `t()`. The strings live in the `settings.customTheme.vars` catalog. */
const VAR_DESCRIPTIONS: Record<string, string> = {
    'bg-primary': 'settings.customTheme.vars.bgPrimary',
    'bg-secondary': 'settings.customTheme.vars.bgSecondary',
    'bg-tertiary': 'settings.customTheme.vars.bgTertiary',
    'text-primary': 'settings.customTheme.vars.textPrimary',
    'text-secondary': 'settings.customTheme.vars.textSecondary',
    'text-tertiary': 'settings.customTheme.vars.textTertiary',
    'text-on-accent': 'settings.customTheme.vars.textOnAccent',
    'border-color': 'settings.customTheme.vars.borderColor',
    'accent-color': 'settings.customTheme.vars.accentColor',
    'accent-hover': 'settings.customTheme.vars.accentHover',
    'accent-light': 'settings.customTheme.vars.accentLight',
    'accent-secondary': 'settings.customTheme.vars.accentSecondary',
    'link-color': 'settings.customTheme.vars.linkColor',
    'input-bg': 'settings.customTheme.vars.inputBg',
    'btn-bg': 'settings.customTheme.vars.btnBg',
    'btn-hover-bg': 'settings.customTheme.vars.btnHoverBg',
    'btn-secondary-bg': 'settings.customTheme.vars.btnSecondaryBg',
    'btn-secondary-hover-bg': 'settings.customTheme.vars.btnSecondaryHoverBg',
    'btn-danger-bg': 'settings.customTheme.vars.btnDangerBg',
    'btn-danger-hover-bg': 'settings.customTheme.vars.btnDangerHoverBg',
    'hover-bg': 'settings.customTheme.vars.hoverBg',
    'placeholder-color': 'settings.customTheme.vars.placeholderColor',
    'success-color': 'settings.customTheme.vars.successColor',
    'status-success': 'settings.customTheme.vars.statusSuccess',
    'status-error': 'settings.customTheme.vars.statusError',
    'color-danger': 'settings.customTheme.vars.colorDanger',
    'color-danger-shade': 'settings.customTheme.vars.colorDangerShade',
    'color-danger-bg': 'settings.customTheme.vars.colorDangerBg',
    'color-danger-bg-hover': 'settings.customTheme.vars.colorDangerBgHover',
    'color-danger-border': 'settings.customTheme.vars.colorDangerBorder',
    'color-warning': 'settings.customTheme.vars.colorWarning',
    'chat-msg-user-bg': 'settings.customTheme.vars.chatMsgUserBg',
    'chat-msg-user-text': 'settings.customTheme.vars.chatMsgUserText',
    'chat-msg-model-text': 'settings.customTheme.vars.chatMsgModelText',
    'code-bg': 'settings.customTheme.vars.codeBg',
    'code-text': 'settings.customTheme.vars.codeText',
    'ai-header-bg': 'settings.customTheme.vars.aiHeaderBg',
    'ai-welcome-text': 'settings.customTheme.vars.aiWelcomeText',
    'ai-welcome-subtext': 'settings.customTheme.vars.aiWelcomeSubtext',
    'ai-chat-content-font-size': 'settings.customTheme.vars.aiChatContentFontSize',
    'ai-token-font-size': 'settings.customTheme.vars.aiTokenFontSize',
    'ai-markdown-h1-font-size': 'settings.customTheme.vars.aiMarkdownH1FontSize',
    'ai-markdown-h2-font-size': 'settings.customTheme.vars.aiMarkdownH2FontSize',
    'ai-markdown-h3-font-size': 'settings.customTheme.vars.aiMarkdownH3FontSize',
    'ai-markdown-table-font-size': 'settings.customTheme.vars.aiMarkdownTableFontSize',
    'sidebar-bg': 'settings.customTheme.vars.sidebarBg',
    'sidebar-btn-color': 'settings.customTheme.vars.sidebarBtnColor',
    'sidebar-btn-hover-bg': 'settings.customTheme.vars.sidebarBtnHoverBg',
    'sidebar-btn-hover-color': 'settings.customTheme.vars.sidebarBtnHoverColor',
    'sidebar-btn-active-bg': 'settings.customTheme.vars.sidebarBtnActiveBg',
    'tab-bg': 'settings.customTheme.vars.tabBg',
    'tab-text': 'settings.customTheme.vars.tabText',
    'tab-active-text': 'settings.customTheme.vars.tabActiveText',
    'tab-close-bg': 'settings.customTheme.vars.tabCloseBg',
    'tab-close-hover-bg': 'settings.customTheme.vars.tabCloseHoverBg',
    'tab-watching-text': 'settings.customTheme.vars.tabWatchingText',
    'tab-watching-bg': 'settings.customTheme.vars.tabWatchingBg',
    'tab-watching-icon': 'settings.customTheme.vars.tabWatchingIcon',
    'tab-watching-icon-glow': 'settings.customTheme.vars.tabWatchingIconGlow',
    'tab-connecting-bg': 'settings.customTheme.vars.tabConnectingBg',
    'tab-connecting-text': 'settings.customTheme.vars.tabConnectingText',
    'pane-connecting-bg': 'settings.customTheme.vars.paneConnectingBg',
    'context-menu-bg': 'settings.customTheme.vars.contextMenuBg',
    'context-menu-border': 'settings.customTheme.vars.contextMenuBorder',
    'context-menu-text': 'settings.customTheme.vars.contextMenuText',
    'context-menu-hover-bg': 'settings.customTheme.vars.contextMenuHoverBg',
    'hidden-item-bg': 'settings.customTheme.vars.hiddenItemBg',
    'hidden-item-bg-hover': 'settings.customTheme.vars.hiddenItemBgHover',
    'tree-meta-color': 'settings.customTheme.vars.treeMetaColor',
    'icon-folder': 'settings.customTheme.vars.iconFolder',
    'icon-host': 'settings.customTheme.vars.iconHost',
    'terminal-prompt-default': 'settings.customTheme.vars.terminalPromptDefault',
    'terminal-prompt-active': 'settings.customTheme.vars.terminalPromptActive',
    'terminal-letterbox-bg': 'settings.customTheme.vars.terminalLetterboxBg',
    'pane-color-1': 'settings.customTheme.vars.paneColor1',
    'pane-color-2': 'settings.customTheme.vars.paneColor2',
    'pane-color-3': 'settings.customTheme.vars.paneColor3',
    'pane-color-4': 'settings.customTheme.vars.paneColor4',
    'pane-color-5': 'settings.customTheme.vars.paneColor5',
    'pane-color-6': 'settings.customTheme.vars.paneColor6',
    'resize-grip-shadow': 'settings.customTheme.vars.resizeGripShadow',
    'search-highlight-bg': 'settings.customTheme.vars.searchHighlightBg',
    'search-highlight-current-bg': 'settings.customTheme.vars.searchHighlightCurrentBg',
    'search-highlight-current-border': 'settings.customTheme.vars.searchHighlightCurrentBorder',
    'search-highlight-mark-bg': 'settings.customTheme.vars.searchHighlightMarkBg',
    'search-highlight-mark-solid': 'settings.customTheme.vars.searchHighlightMarkSolid',
    'search-highlight-mark-text': 'settings.customTheme.vars.searchHighlightMarkText',
    'modal-overlay-bg': 'settings.customTheme.vars.modalOverlayBg',
    'modal-shadow': 'settings.customTheme.vars.modalShadow',
    'modal-border-warning': 'settings.customTheme.vars.modalBorderWarning',
    'modal-header-warning-bg': 'settings.customTheme.vars.modalHeaderWarningBg',
    'modal-header-warning-text': 'settings.customTheme.vars.modalHeaderWarningText',
    'modal-border-error': 'settings.customTheme.vars.modalBorderError',
    'modal-header-error-bg': 'settings.customTheme.vars.modalHeaderErrorBg',
    'modal-header-error-text': 'settings.customTheme.vars.modalHeaderErrorText',
    'modal-border-success': 'settings.customTheme.vars.modalBorderSuccess',
    'modal-header-success-bg': 'settings.customTheme.vars.modalHeaderSuccessBg',
    'modal-header-success-text': 'settings.customTheme.vars.modalHeaderSuccessText',
    'modal-header-info-bg': 'settings.customTheme.vars.modalHeaderInfoBg',
    'modal-header-info-border': 'settings.customTheme.vars.modalHeaderInfoBorder',
    'modal-header-info-text': 'settings.customTheme.vars.modalHeaderInfoText',
    'update-notification-bg': 'settings.customTheme.vars.updateNotificationBg',
    'update-notification-border': 'settings.customTheme.vars.updateNotificationBorder',
    'update-notification-text': 'settings.customTheme.vars.updateNotificationText',
    'update-notification-accent': 'settings.customTheme.vars.updateNotificationAccent',
    'update-notification-btn-bg': 'settings.customTheme.vars.updateNotificationBtnBg',
    'update-notification-btn-text': 'settings.customTheme.vars.updateNotificationBtnText',
    'update-notification-btn-border': 'settings.customTheme.vars.updateNotificationBtnBorder',
    'update-notification-btn-hover': 'settings.customTheme.vars.updateNotificationBtnHover',
    'provider-gemini-1': 'settings.customTheme.vars.providerGemini1',
    'provider-gemini-2': 'settings.customTheme.vars.providerGemini2',
    'provider-gemini-3': 'settings.customTheme.vars.providerGemini3',
    'provider-openai': 'settings.customTheme.vars.providerOpenai',
    'provider-anthropic': 'settings.customTheme.vars.providerAnthropic',
    'provider-vertex-ai': 'settings.customTheme.vars.providerVertexAi',
    'glow-accent': 'settings.customTheme.vars.glowAccent',
    'glow-accent-strong': 'settings.customTheme.vars.glowAccentStrong',
    'glow-blur': 'settings.customTheme.vars.glowBlur',
    'glass-bg': 'settings.customTheme.vars.glassBg',
    'glass-blur': 'settings.customTheme.vars.glassBlur',
    'glass-border': 'settings.customTheme.vars.glassBorder',
    'icon-stroke-width': 'settings.customTheme.vars.iconStrokeWidth',
};

const isSimpleHexColor = (value: string): boolean =>
    /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value.trim());

const isPureCssColor = (value: string): boolean =>
    /^(rgba?|hsla?)\s*\([^)]+\)$/i.test(value.trim());

export const CustomThemeCreator: React.FC<CustomThemeCreatorProps> = ({
    isOpen,
    themesData,
    currentTheme,
    onSave,
    onCancel,
}) => {
    const { t } = useTranslation();
    const [displayName, setDisplayName] = useState('');
    const [baseTheme, setBaseTheme] = useState(currentTheme);
    const [variables, setVariables] = useState<Record<string, string>>({});
    const [terminal, setTerminal] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [originalVariables, setOriginalVariables] = useState<Record<string, string>>({});

    const applyVariables = useCallback((vars: Record<string, string>) => {
        Object.entries(vars).forEach(([key, value]) => {
            document.documentElement.style.setProperty(`--${key}`, value);
        });
    }, []);

    const initFromTheme = useCallback((themeKey: string, captureOriginal: boolean) => {
        const def = themesData[themeKey];
        if (!def) return;
        const vars = { ...def.variables };
        const term: Record<string, string> = { ...def.terminal };
        setVariables(vars);
        setTerminal(term);
        applyVariables(vars);
        if (captureOriginal) setOriginalVariables(vars);
    }, [themesData, applyVariables]);

    useEffect(() => {
        if (isOpen) {
            setDisplayName('');
            setError('');
            setBaseTheme(currentTheme);
            initFromTheme(currentTheme, true);
        }
    }, [isOpen, currentTheme, initFromTheme]);

    const handleBaseThemeChange = (themeKey: string) => {
        setBaseTheme(themeKey);
        initFromTheme(themeKey, false);
    };

    const handleVariableChange = (key: string, value: string) => {
        setVariables(prev => {
            const next = { ...prev, [key]: value };
            document.documentElement.style.setProperty(`--${key}`, value);
            return next;
        });
    };

    const handleTerminalChange = (key: string, value: string) => {
        setTerminal(prev => ({ ...prev, [key]: value }));
    };

    const handleCancel = () => {
        if (Object.keys(originalVariables).length > 0) {
            applyVariables(originalVariables);
        }
        onCancel();
    };

    const handleSave = async () => {
        const name = displayName.trim();
        if (!name) {
            setError(t('settings.customTheme.errorEmptyName'));
            return;
        }
        const key = nameToKey(name);
        if (!key) {
            setError(t('settings.customTheme.errorNoAlphanumeric'));
            return;
        }
        if (PROTECTED_THEMES.includes(key)) {
            setError(t('settings.customTheme.errorProtectedName'));
            return;
        }

        const themeData: Theme = {
            name,
            variables,
            terminal: {
                foreground: terminal.foreground ?? '',
                background: terminal.background ?? '',
                backgroundInactive: terminal.backgroundInactive ?? '',
                paneBackground: terminal.paneBackground ?? '',
            },
        };

        setSaving(true);
        try {
            const result = await tauriService.saveCustomTheme(key, themeData);
            if (result.success) {
                onSave(key);
            } else {
                setError(result.error || t('settings.customTheme.errorSaveFailed'));
            }
        } catch (err) {
            setError(String(err));
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    const themeKeys = Object.keys(themesData || {});

    return (
        <div className="ctc-overlay">
            <div className="ctc-modal">
                <div className="ctc-header">
                    <h2>{t('settings.customTheme.title')}</h2>
                    <button className="ctc-close-btn" onClick={handleCancel} title={t('settings.customTheme.cancel')}>✕</button>
                </div>

                <div className="ctc-toolbar">
                    <div className="ctc-toolbar-row">
                        <label className="ctc-label">{t('settings.customTheme.themeName')}</label>
                        <input
                            type="text"
                            className="ctc-name-input"
                            value={displayName}
                            onChange={e => { setDisplayName(e.target.value); setError(''); }}
                            placeholder={t('settings.customTheme.themeNamePlaceholder')}
                        />
                    </div>
                    <div className="ctc-toolbar-row">
                        <label className="ctc-label">{t('settings.customTheme.baseTheme')}</label>
                        <select
                            className="ctc-select"
                            value={baseTheme}
                            onChange={e => handleBaseThemeChange(e.target.value)}
                        >
                            {themeKeys.map(k => (
                                <option key={k} value={k}>
                                    {themesData[k]?.name ?? k}
                                </option>
                            ))}
                        </select>
                    </div>
                    {error && <div className="ctc-error">{error}</div>}
                </div>

                <div className="ctc-body">
                    {THEME_SECTIONS.map(section => (
                        <div key={section.titleKey} className="ctc-section">
                            <div className="ctc-section-header">
                                <span className="ctc-section-title">{t(section.titleKey)}</span>
                                <span className="ctc-section-desc">{t(section.descKey)}</span>
                            </div>
                            {section.keys.filter(k => k in variables).map(key => (
                                <VariableRow
                                    key={key}
                                    varKey={key}
                                    value={variables[key] ?? ''}
                                    description={t(VAR_DESCRIPTIONS[key])}
                                    onChange={handleVariableChange}
                                />
                            ))}
                        </div>
                    ))}

                    <div className="ctc-section">
                        <div className="ctc-section-header">
                            <span className="ctc-section-title">{t('settings.customTheme.terminalSectionTitle')}</span>
                            <span className="ctc-section-desc">{t('settings.customTheme.terminalSectionDesc')}</span>
                        </div>
                        {TERMINAL_KEYS.map(({ key, labelKey, descKey }) => (
                            <div key={key} className="ctc-row">
                                <div className="ctc-row-info">
                                    <span className="ctc-var-key">{t(labelKey)}</span>
                                    <span className="ctc-var-desc">{t(descKey)}</span>
                                </div>
                                <div className="ctc-row-controls">
                                    {isSimpleHexColor(terminal[key] ?? '') && (
                                        <input
                                            type="color"
                                            className="ctc-color-picker"
                                            value={(terminal[key] ?? '#000000').slice(0, 7)}
                                            onChange={e => handleTerminalChange(key, e.target.value)}
                                        />
                                    )}
                                    <input
                                        type="text"
                                        className="ctc-text-input"
                                        value={terminal[key] ?? ''}
                                        onChange={e => handleTerminalChange(key, e.target.value)}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="ctc-footer">
                    <button className="ctc-btn-cancel" onClick={handleCancel} disabled={saving}>
                        {t('settings.customTheme.cancel')}
                    </button>
                    <button className="ctc-btn-save" onClick={handleSave} disabled={saving}>
                        {saving ? t('settings.customTheme.saving') : t('settings.customTheme.saveTheme')}
                    </button>
                </div>
            </div>
        </div>
    );
};

interface VariableRowProps {
    varKey: string;
    value: string;
    description?: string;
    onChange: (key: string, value: string) => void;
}

const VariableRow: React.FC<VariableRowProps> = ({ varKey, value, description, onChange }) => {
    const isHex = isSimpleHexColor(value);
    const isCssColor = isPureCssColor(value);

    return (
        <div className="ctc-row">
            <div className="ctc-row-info">
                <span className="ctc-var-key" title={description}>{varKey}</span>
            </div>
            <div className="ctc-row-controls">
                {isHex && (
                    <input
                        type="color"
                        className="ctc-color-picker"
                        value={value.slice(0, 7)}
                        onChange={e => onChange(varKey, e.target.value)}
                    />
                )}
                {isCssColor && (
                    <span
                        className="ctc-color-swatch"
                        style={{ backgroundColor: value }}
                        title={value}
                    />
                )}
                <input
                    type="text"
                    className="ctc-text-input"
                    value={value}
                    onChange={e => onChange(varKey, e.target.value)}
                />
            </div>
        </div>
    );
};
