import React, { useState, useEffect, useCallback } from 'react';
import * as electronService from '../../services/electronService';
import './CustomThemeCreator.css';

interface ThemeDef {
    name: string;
    variables: Record<string, string>;
    terminal: Record<string, string>;
}

interface CustomThemeCreatorProps {
    isOpen: boolean;
    themesData: Record<string, ThemeDef>;
    currentTheme: string;
    onSave: (themeKey: string) => void;
    onCancel: () => void;
}

const PROTECTED_THEMES = ['dark', 'medium', 'light'];

const THEME_SECTIONS: { title: string; description: string; keys: string[] }[] = [
    {
        title: 'Backgrounds & Text',
        description: 'Main background and text colors',
        keys: ['bg-primary', 'bg-secondary', 'bg-tertiary', 'panel-bg', 'text-primary', 'text-secondary', 'text-on-accent'],
    },
    {
        title: 'Borders & Accents',
        description: 'Border colors and accent/highlight colors',
        keys: ['border-color', 'accent-color', 'accent-hover', 'accent-light', 'accent-secondary', 'active-pane-color'],
    },
    {
        title: 'Inputs, Buttons & Hovers',
        description: 'Input fields, buttons, and hover state colors',
        keys: ['input-bg', 'btn-bg', 'btn-hover-bg', 'btn-secondary-bg', 'btn-secondary-hover-bg', 'btn-danger-bg', 'btn-danger-hover-bg', 'hover-bg', 'placeholder-color'],
    },
    {
        title: 'Status & Signals',
        description: 'Success, error, warning, and danger indicator colors',
        keys: ['success-color', 'error-color', 'color-danger', 'color-danger-bg', 'color-danger-bg-hover', 'color-danger-border', 'color-warning'],
    },
    {
        title: 'AI Chat (Gemini)',
        description: 'Colors for AI chat messages and code blocks',
        keys: ['chat-msg-user-bg', 'chat-msg-model-bg', 'chat-msg-user-text', 'chat-msg-model-text', 'code-bg', 'code-text', 'ai-header-bg', 'ai-welcome-text', 'ai-welcome-subtext'],
    },
    {
        title: 'UI Specific Components',
        description: 'Sidebar, tabs, context menus, icons, and other UI elements',
        keys: ['sidebar-bg', 'sidebar-btn-color', 'sidebar-btn-hover-bg', 'sidebar-btn-hover-color', 'sidebar-btn-active-bg', 'tab-bg', 'tab-text', 'tab-active-bg', 'tab-active-text', 'tab-close-bg', 'tab-close-hover-bg', 'tab-drag-indicator', 'tab-watching-text', 'tab-watching-bg', 'tab-watching-icon', 'tab-watching-icon-glow', 'context-menu-bg', 'context-menu-border', 'context-menu-text', 'context-menu-hover-bg', 'hidden-item-bg', 'hidden-item-bg-hover', 'tree-meta-color', 'icon-folder', 'icon-host', 'terminal-prompt-default', 'terminal-prompt-active'],
    },
    {
        title: 'Search & Highlight',
        description: 'Search result highlight colors',
        keys: ['search-highlight-bg', 'search-highlight-current-bg', 'search-highlight-current-border', 'search-highlight-mark-bg', 'search-highlight-mark-solid', 'search-highlight-mark-text'],
    },
    {
        title: 'Overlays & Modals',
        description: 'Modal dialogs, overlays, and notification banners',
        keys: ['modal-overlay-bg', 'modal-shadow', 'modal-border-warning', 'modal-header-warning-bg', 'modal-header-warning-border', 'modal-header-warning-text', 'modal-border-error', 'modal-header-error-bg', 'modal-header-error-border', 'modal-header-error-text', 'modal-border-success', 'modal-header-success-bg', 'modal-header-success-border', 'modal-header-success-text', 'modal-header-info-bg', 'modal-header-info-border', 'modal-header-info-text'],
    },
];

const TERMINAL_KEYS: { key: string; label: string; description: string }[] = [
    { key: 'foreground', label: 'Foreground', description: 'Default text color inside the terminal' },
    { key: 'background', label: 'Background (Active)', description: 'Background for the active/focused terminal' },
    { key: 'backgroundInactive', label: 'Background (Inactive)', description: 'Background for inactive/unfocused terminals' },
    { key: 'paneBackground', label: 'Pane Background', description: 'Color of the space surrounding the terminal' },
];

const VAR_DESCRIPTIONS: Record<string, string> = {
    // Backgrounds & Text
    'bg-primary': 'The main background color for the application and active panes.',
    'bg-secondary': 'Background color for sidebars, headers, and UI elements.',
    'bg-tertiary': 'Background color for inactive tabs and dropdowns.',
    'panel-bg': 'Background color for panel areas.',
    'text-primary': 'The main text color.',
    'text-secondary': 'Color for less important text or hints.',
    'text-on-accent': 'Text color used on top of accent-colored elements (e.g., buttons).',
    // Borders & Accents
    'border-color': 'Color for pane borders and dividers.',
    'accent-color': 'Primary color for buttons, active indicators, and links.',
    'accent-hover': 'Hover state color for accented elements.',
    'accent-light': 'A lighter variation of the accent color.',
    'accent-secondary': 'A secondary accent color for additional highlights.',
    'active-pane-color': 'Color used to highlight the currently active terminal pane.',
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
    'error-color': 'General color for error messages.',
    'color-danger': 'Color indicating destructive actions or errors.',
    'color-danger-bg': 'Background tint for danger elements.',
    'color-danger-bg-hover': 'Hover background tint for danger elements.',
    'color-danger-border': 'Border color for danger elements.',
    'color-warning': 'Color for warning or attention-required text.',
    // AI Chat (Gemini)
    'chat-msg-user-bg': 'Background color for messages sent by the user.',
    'chat-msg-model-bg': 'Background color for messages from the AI.',
    'chat-msg-user-text': 'Text color for user messages.',
    'chat-msg-model-text': 'Text color for AI responses.',
    'code-bg': 'Background color for code blocks within the chat.',
    'code-text': 'Text color for code blocks.',
    'ai-header-bg': 'Background tint for the AI chat header.',
    'ai-welcome-text': 'Color for the large welcome heading.',
    'ai-welcome-subtext': 'Color for the descriptive text in the empty chat state.',
    // UI Specific Components
    'select-arrow': 'An SVG data URL for the dropdown arrow icon.',
    'sidebar-bg': 'Background color specifically for the left sidebar.',
    'sidebar-btn-color': 'Icon/Text color for sidebar buttons (default).',
    'sidebar-btn-hover-bg': 'Background color when hovering over sidebar buttons.',
    'sidebar-btn-hover-color': 'Icon/Text color when hovering over sidebar buttons.',
    'sidebar-btn-active-bg': 'Background color for the currently selected sidebar button.',
    'tab-bg': 'Background color for inactive tabs.',
    'tab-text': 'Text color for inactive tabs.',
    'tab-active-bg': 'Background color for the currently selected tab.',
    'tab-active-text': 'Text color for the currently selected tab.',
    'tab-close-bg': 'Color of the tab\'s close button.',
    'tab-close-hover-bg': 'Hover color of the tab\'s close button.',
    'tab-drag-indicator': 'Color of the line indicating tab insertion position.',
    'tab-watching-text': 'Text color for a tab that is currently being monitored by AI.',
    'tab-watching-bg': 'Background/fill color for the AI monitoring icon in a tab.',
    'tab-watching-icon': 'Primary glow color for the AI monitoring icon.',
    'tab-watching-icon-glow': 'Secondary glow color for the AI monitoring icon gradient.',
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
    // Search & Highlight
    'search-highlight-bg': 'Background tint for lines that contain a search match.',
    'search-highlight-current-bg': 'Background for the currently focused search match line.',
    'search-highlight-current-border': 'Outline color for the currently focused match line.',
    'search-highlight-mark-bg': 'Background highlight for the matched text span inside a line.',
    'search-highlight-mark-solid': 'Solid background for the matched text span on the currently focused line.',
    'search-highlight-mark-text': 'Text color for highlighted match spans.',
    // Overlays & Modals
    'modal-overlay-bg': 'Background dimming for modal dialogs.',
    'modal-shadow': 'Shadow effects for modals.',
    'modal-border-warning': 'Border color for warning modals.',
    'modal-header-warning-bg': 'Header background for warning modals.',
    'modal-header-warning-border': 'Header border for warning modals.',
    'modal-header-warning-text': 'Header text for warning modals.',
    'modal-border-error': 'Border color for error modals.',
    'modal-header-error-bg': 'Header background for error modals.',
    'modal-header-error-border': 'Header border for error modals.',
    'modal-header-error-text': 'Header text for error modals.',
    'modal-border-success': 'Border color for success modals.',
    'modal-header-success-bg': 'Header background for success modals.',
    'modal-header-success-border': 'Header border for success modals.',
    'modal-header-success-text': 'Header text for success modals.',
    'modal-header-info-bg': 'Header background for info modals.',
    'modal-header-info-border': 'Header border for info modals.',
    'modal-header-info-text': 'Header text for info modals.',
};

const isSimpleHexColor = (value: string): boolean =>
    /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value.trim());

const nameToKey = (name: string): string =>
    name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');

export const CustomThemeCreator: React.FC<CustomThemeCreatorProps> = ({
    isOpen,
    themesData,
    currentTheme,
    onSave,
    onCancel,
}) => {
    const [displayName, setDisplayName] = useState('');
    const [baseTheme, setBaseTheme] = useState(currentTheme);
    const [variables, setVariables] = useState<Record<string, string>>({});
    const [terminal, setTerminal] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const applyVariables = useCallback((vars: Record<string, string>) => {
        Object.entries(vars).forEach(([key, value]) => {
            document.documentElement.style.setProperty(`--${key}`, value);
        });
    }, []);

    const initFromTheme = useCallback((themeKey: string) => {
        const def = themesData[themeKey];
        if (!def) return;
        const vars = { ...def.variables };
        const term = { ...def.terminal };
        setVariables(vars);
        setTerminal(term);
        applyVariables(vars);
    }, [themesData, applyVariables]);

    useEffect(() => {
        if (isOpen) {
            setDisplayName('');
            setError('');
            setBaseTheme(currentTheme);
            initFromTheme(currentTheme);
        }
    }, [isOpen, currentTheme, initFromTheme]);

    const handleBaseThemeChange = (themeKey: string) => {
        setBaseTheme(themeKey);
        initFromTheme(themeKey);
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

    const handleSave = async () => {
        const name = displayName.trim();
        if (!name) {
            setError('Please enter a theme name.');
            return;
        }
        const key = nameToKey(name);
        if (!key) {
            setError('Theme name must contain at least one alphanumeric character.');
            return;
        }
        if (PROTECTED_THEMES.includes(key)) {
            setError('Cannot use "dark", "medium", or "light" as a theme name.');
            return;
        }

        const themeData: ThemeDef = {
            name,
            variables,
            terminal,
        };

        setSaving(true);
        try {
            const result = await electronService.saveCustomTheme(key, themeData as unknown as Record<string, unknown>);
            if (result.success) {
                onSave(key);
            } else {
                setError(result.error || 'Failed to save theme.');
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
                    <h2>Custom Theme Creator</h2>
                    <button className="ctc-close-btn" onClick={onCancel} title="Cancel">✕</button>
                </div>

                <div className="ctc-toolbar">
                    <div className="ctc-toolbar-row">
                        <label className="ctc-label">Theme Name</label>
                        <input
                            type="text"
                            className="ctc-name-input"
                            value={displayName}
                            onChange={e => { setDisplayName(e.target.value); setError(''); }}
                            placeholder="e.g. My Dark Blue"
                        />
                    </div>
                    <div className="ctc-toolbar-row">
                        <label className="ctc-label">Base Theme</label>
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
                        <div key={section.title} className="ctc-section">
                            <div className="ctc-section-header">
                                <span className="ctc-section-title">{section.title}</span>
                                <span className="ctc-section-desc">{section.description}</span>
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
                            <span className="ctc-section-title">Terminal</span>
                            <span className="ctc-section-desc">xterm.js terminal colors</span>
                        </div>
                        {TERMINAL_KEYS.map(({ key, label, description }) => (
                            <div key={key} className="ctc-row">
                                <div className="ctc-row-info">
                                    <span className="ctc-var-key">{label}</span>
                                    <span className="ctc-var-desc">{description}</span>
                                </div>
                                <div className="ctc-row-controls">
                                    {isSimpleHexColor(terminal[key] ?? '') && (
                                        <input
                                            type="color"
                                            className="ctc-color-picker"
                                            value={terminal[key] ?? '#000000'}
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
                    <button className="ctc-btn-cancel" onClick={onCancel} disabled={saving}>
                        Cancel
                    </button>
                    <button className="ctc-btn-save" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving...' : 'Save Theme'}
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
    const isColor = isSimpleHexColor(value);
    const isComplex = varKey === 'select-arrow' || varKey === 'modal-shadow';

    if (isComplex) {
        return (
            <div className="ctc-row">
                <div className="ctc-row-info">
                    <span className="ctc-var-key" title={description}>{varKey}</span>
                </div>
                <div className="ctc-row-controls">
                    <input
                        type="text"
                        className="ctc-text-input ctc-text-input--wide"
                        value={value}
                        onChange={e => onChange(varKey, e.target.value)}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="ctc-row">
            <div className="ctc-row-info">
                <span className="ctc-var-key" title={description}>{varKey}</span>
            </div>
            <div className="ctc-row-controls">
                {isColor && (
                    <input
                        type="color"
                        className="ctc-color-picker"
                        value={value.slice(0, 7)}
                        onChange={e => onChange(varKey, e.target.value)}
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
