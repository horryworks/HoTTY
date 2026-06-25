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
        keys: ['sidebar-bg', 'sidebar-btn-color', 'sidebar-btn-hover-bg', 'sidebar-btn-hover-color', 'sidebar-btn-active-bg', 'tab-bg', 'tab-text', 'tab-active-text', 'tab-close-bg', 'tab-close-hover-bg', 'tab-watching-text', 'tab-watching-bg', 'tab-watching-icon', 'tab-watching-icon-glow', 'tab-connecting-bg', 'tab-connecting-text', 'pane-connecting-bg', 'context-menu-bg', 'context-menu-border', 'context-menu-text', 'context-menu-hover-bg', 'hidden-item-bg', 'hidden-item-bg-hover', 'tree-meta-color', 'icon-folder', 'icon-host', 'terminal-prompt-default', 'terminal-prompt-active', 'pane-color-1', 'pane-color-2', 'pane-color-3', 'pane-color-4', 'pane-color-5', 'pane-color-6', 'resize-grip-shadow'],
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

const VAR_DESCRIPTIONS: Record<string, string> = {
    // Backgrounds & Text
    'bg-primary': 'The main background color for the application and active panes.',
    'bg-secondary': 'Background color for sidebars, headers, and UI elements.',
    'bg-tertiary': 'Background color for inactive tabs and dropdowns.',
    'text-primary': 'The main text color.',
    'text-secondary': 'Color for less important text or hints.',
    'text-tertiary': 'Color for the dimmest level of text (e.g., drag handles, muted hints).',
    'text-on-accent': 'Text color used on top of accent-colored elements (e.g., buttons).',
    // Borders & Accents
    'border-color': 'Color for pane borders and dividers.',
    'accent-color': 'Primary color for buttons, active indicators, and links.',
    'accent-hover': 'Hover state color for accented elements.',
    'accent-light': 'A lighter variation of the accent color.',
    'accent-secondary': 'A secondary accent color for additional highlights.',
    'link-color': 'Color for hyperlinks and URL-style references.',
    // Inputs, Buttons & Hovers
    'input-bg': 'Background color for text input fields and setting rows.',
    'btn-bg': 'Background color for standard buttons.',
    'btn-hover-bg': 'Background color for standard buttons on hover.',
    'btn-secondary-bg': 'Background color for secondary buttons (e.g., Cancel).',
    'btn-secondary-hover-bg': 'Hover background for secondary buttons.',
    'btn-danger-bg': 'Background color for destructive action buttons.',
    'btn-danger-hover-bg': 'Hover background for danger buttons.',
    'hover-bg': 'General hover background for list items or interactive rows.',
    'placeholder-color': 'Color for placeholder text in input fields.',
    // Status & Signals
    'success-color': 'Color used for success indicators (connection established, etc.).',
    'status-success': 'Color for authenticated/success status indicator dots.',
    'status-error': 'Color for unauthenticated/error status indicator dots.',
    'color-danger': 'Color indicating destructive actions or errors.',
    'color-danger-shade': 'Darker shade of the danger color, used at the ends of the hidden-AI-tab gradient.',
    'color-danger-bg': 'Background tint for danger elements.',
    'color-danger-bg-hover': 'Hover background tint for danger elements.',
    'color-danger-border': 'Border color for danger elements.',
    'color-warning': 'Color for warning or attention-required text.',
    // AI Chat
    'chat-msg-user-bg': 'Background color for messages sent by the user.',
    'chat-msg-user-text': 'Text color for user messages.',
    'chat-msg-model-text': 'Text color for AI responses.',
    'code-bg': 'Background color for code blocks within the chat.',
    'code-text': 'Text color for code blocks.',
    'ai-header-bg': 'Background tint for the AI chat header.',
    'ai-welcome-text': 'Color for the large welcome heading.',
    'ai-welcome-subtext': 'Color for the descriptive text in the empty chat state.',
    'ai-chat-content-font-size': 'Font size for AI chat message content (e.g., 1.1em).',
    'ai-token-font-size': 'Font size for the token usage status bar (e.g., 0.78em).',
    'ai-markdown-h1-font-size': 'Font size for h1 headings in AI markdown (e.g., 1.3em).',
    'ai-markdown-h2-font-size': 'Font size for h2 headings in AI markdown (e.g., 1.15em).',
    'ai-markdown-h3-font-size': 'Font size for h3 headings in AI markdown (e.g., 1.05em).',
    'ai-markdown-table-font-size': 'Font size for tables in AI markdown (e.g., 0.9em).',
    // UI Specific Components
    'sidebar-bg': 'Background color specifically for the left sidebar.',
    'sidebar-btn-color': 'Icon/Text color for sidebar buttons (default).',
    'sidebar-btn-hover-bg': 'Background color when hovering over sidebar buttons.',
    'sidebar-btn-hover-color': 'Icon/Text color when hovering over sidebar buttons.',
    'sidebar-btn-active-bg': 'Background color for the currently selected sidebar button.',
    'tab-bg': 'Background color for inactive tabs.',
    'tab-text': 'Text color for inactive tabs.',
    'tab-active-text': 'Text color for the currently selected tab.',
    'tab-close-bg': 'Color of the tab\'s close button.',
    'tab-close-hover-bg': 'Hover color of the tab\'s close button.',
    'tab-watching-text': 'Text color for a tab that is currently being monitored by AI.',
    'tab-watching-bg': 'Background/fill color for the AI monitoring icon in a tab.',
    'tab-watching-icon': 'Primary glow color for the AI monitoring icon.',
    'tab-watching-icon-glow': 'Secondary glow color for the AI monitoring icon gradient.',
    'tab-connecting-bg': 'Background color for a tab while its session is connecting.',
    'tab-connecting-text': 'Text color for a tab while its session is connecting (also used for the pane overlay text).',
    'pane-connecting-bg': 'Background color of the pane overlay shown while a session is connecting.',
    'context-menu-bg': 'Background for right-click menus.',
    'context-menu-border': 'Border for right-click menus.',
    'context-menu-text': 'Text color for right-click menus.',
    'context-menu-hover-bg': 'Hover background for menu items.',
    'hidden-item-bg': 'Special background for hidden items (debug/admin).',
    'hidden-item-bg-hover': 'Hover background for hidden items.',
    'tree-meta-color': 'Color for metadata in list views (e.g., file sizes).',
    'icon-folder': 'Color for folder icons in the host tree.',
    'icon-host': 'Color for host/connection icons in the host tree.',
    'terminal-prompt-default': 'Default color for terminal prompt marker blocks.',
    'terminal-prompt-active': 'Active color for terminal prompt marker blocks when detected as command input.',
    'pane-color-1': 'Color 1 of 6 used for tab-to-pane connection lines.',
    'pane-color-2': 'Color 2 of 6 used for tab-to-pane connection lines.',
    'pane-color-3': 'Color 3 of 6 used for tab-to-pane connection lines.',
    'pane-color-4': 'Color 4 of 6 used for tab-to-pane connection lines.',
    'pane-color-5': 'Color 5 of 6 used for tab-to-pane connection lines.',
    'pane-color-6': 'Color 6 of 6 used for tab-to-pane connection lines.',
    'resize-grip-shadow': 'Color for the stripe pattern on the resize grip handle.',
    // Search & Highlight
    'search-highlight-bg': 'Background tint for lines that contain a search match.',
    'search-highlight-current-bg': 'Background for the currently focused search match line.',
    'search-highlight-current-border': 'Outline color for the currently focused match line.',
    'search-highlight-mark-bg': 'Background highlight for the matched text span inside a line.',
    'search-highlight-mark-solid': 'Solid background for the matched text span on the currently focused line.',
    'search-highlight-mark-text': 'Text color for highlighted match spans.',
    // Overlays & Modals
    'modal-overlay-bg': 'Background dimming for modal dialogs.',
    'modal-shadow': 'Shadow color for modals (rgba). The shadow geometry is fixed at 0 4px 16px.',
    'modal-border-warning': 'Border color for warning modals (applied to both the modal container and the header separator).',
    'modal-header-warning-bg': 'Header background for warning modals.',
    'modal-header-warning-text': 'Header text for warning modals.',
    'modal-border-error': 'Border color for error modals (applied to both the modal container and the header separator).',
    'modal-header-error-bg': 'Header background for error modals.',
    'modal-header-error-text': 'Header text for error modals.',
    'modal-border-success': 'Border color for success modals (applied to both the modal container and the header separator).',
    'modal-header-success-bg': 'Header background for success modals.',
    'modal-header-success-text': 'Header text for success modals.',
    'modal-header-info-bg': 'Header background for info modals.',
    'modal-header-info-border': 'Header border for info modals.',
    'modal-header-info-text': 'Header text for info modals.',
    // Update Notification
    'update-notification-bg': 'Background color for the update notification banner.',
    'update-notification-border': 'Bottom border color for the update notification banner.',
    'update-notification-text': 'Text color for the update notification banner.',
    'update-notification-accent': 'Accent color for the version highlight and icon in the update notification.',
    'update-notification-btn-bg': 'Background color for the Download button in the update notification.',
    'update-notification-btn-text': 'Text color for the Download button in the update notification.',
    'update-notification-btn-border': 'Border color for the Download button in the update notification.',
    'update-notification-btn-hover': 'Hover background for the Download button in the update notification.',
    // AI Providers
    'provider-gemini-1': 'First gradient stop of the Gemini icon (start color).',
    'provider-gemini-2': 'Middle gradient stop of the Gemini icon.',
    'provider-gemini-3': 'Final gradient stop of the Gemini icon (end color).',
    'provider-openai': 'Brand color for the OpenAI icon background.',
    'provider-anthropic': 'Brand color for the Anthropic icon background.',
    'provider-vertex-ai': 'Brand color for the Vertex AI icon.',
    // Futuristic Effects
    'glow-accent': 'Neon glow color for the active pane outline and active sidebar icons (rgba recommended).',
    'glow-accent-strong': 'Stronger variant of the neon glow for emphasized elements.',
    'glow-blur': 'Blur radius of the neon glow (e.g., 10px). Larger values spread the glow further.',
    'glass-bg': 'Semi-transparent background for glassmorphism surfaces (modals, sidebars). Use rgba with ~0.7 alpha.',
    'glass-blur': 'backdrop-filter blur strength for glass surfaces (e.g., 14px).',
    'glass-border': 'Subtle border color overlaid on glass surfaces (rgba with low alpha).',
    'icon-stroke-width': 'Default stroke width for line-style SVG icons (e.g., 1.5).',
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
                                    description={VAR_DESCRIPTIONS[key]}
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
