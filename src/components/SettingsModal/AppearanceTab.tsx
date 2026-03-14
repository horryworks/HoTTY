import React from 'react';
import * as electronService from '../../services/electronService';

interface AppearanceTabProps {
    theme: string;
    onThemeChange: (theme: string) => void;
    themesData: Record<string, { name: string; variables: Record<string, string>; terminal: Record<string, string> }> | null;
    sidebarPosition: 'left' | 'right';
    onSidebarPositionChange: (position: 'left' | 'right') => void;
    paneBackground: string;
    onPaneBackgroundChange: (color: string) => void;
    paneBackgroundMode: 'color' | 'image';
    onPaneBackgroundModeChange: (mode: 'color' | 'image') => void;
    paneBackgroundImage: string;
    onPaneBackgroundImageChange: (url: string) => void;
    fontFamily: string;
    onFontFamilyChange: (family: string) => void;
    fontSize: number;
    onFontSizeChange: (size: number) => void;
    encoding: string;
    onEncodingChange: (encoding: string) => void;
    enablePromptHighlight: boolean;
    onEnablePromptHighlightChange: (enabled: boolean) => void;
    promptHighlightColor: string;
    onPromptHighlightColorChange: (color: string) => void;
    promptPatterns: { id: string; name: string; pattern: string; enabled: boolean }[];
    onPromptPatternsChange: (patterns: { id: string; name: string; pattern: string; enabled: boolean }[]) => void;
}

export const AppearanceTab: React.FC<AppearanceTabProps> = ({
    theme,
    onThemeChange,
    themesData,
    sidebarPosition,
    onSidebarPositionChange,
    paneBackground,
    onPaneBackgroundChange,
    paneBackgroundMode,
    onPaneBackgroundModeChange,
    paneBackgroundImage,
    onPaneBackgroundImageChange,
    fontFamily,
    onFontFamilyChange,
    fontSize,
    onFontSizeChange,
    encoding,
    onEncodingChange,
    enablePromptHighlight,
    onEnablePromptHighlightChange,
    promptHighlightColor,
    onPromptHighlightColorChange,
    promptPatterns,
    onPromptPatternsChange,
}) => {
    return (
        <>
            <div className="form-group">
                <label>Toolbar Position</label>
                <div style={{ display: 'flex', gap: '15px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }}>
                        <input
                            type="radio"
                            name="sidebarPosition"
                            value="left"
                            checked={sidebarPosition === 'left'}
                            onChange={() => onSidebarPositionChange('left')}
                            style={{ marginRight: '6px' }}
                        />
                        Left
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }}>
                        <input
                            type="radio"
                            name="sidebarPosition"
                            value="right"
                            checked={sidebarPosition === 'right'}
                            onChange={() => onSidebarPositionChange('right')}
                            style={{ marginRight: '6px' }}
                        />
                        Right
                    </label>
                </div>
            </div>

            <div className="form-group">
                <label>Theme</label>
                {(() => {
                    const THEME_ORDER = ['dark', 'medium', 'light'];
                    const themeKeys = themesData
                        ? [
                            ...THEME_ORDER.filter(k => k in themesData),
                            ...Object.keys(themesData).filter(k => !THEME_ORDER.includes(k)),
                          ]
                        : ['dark', 'medium', 'light'];
                    return (
                        <select
                            value={theme}
                            onChange={(e) => onThemeChange(e.target.value)}
                            className="settings-select"
                        >
                            {themeKeys.map(key => (
                                <option key={key} value={key}>
                                    {themesData?.[key]?.name ?? key.charAt(0).toUpperCase() + key.slice(1)}
                                </option>
                            ))}
                        </select>
                    );
                })()}
            </div>

            <div className="form-group">
                <label>Empty Pane Background</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '10px', color: '#ccc' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }}>
                            <input
                                type="radio"
                                checked={paneBackgroundMode === 'color'}
                                onChange={() => onPaneBackgroundModeChange('color')}
                                style={{ marginRight: '6px' }}
                            /> Color
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }}>
                            <input
                                type="radio"
                                checked={paneBackgroundMode === 'image'}
                                onChange={() => onPaneBackgroundModeChange('image')}
                                style={{ marginRight: '6px' }}
                            /> Image
                        </label>
                    </div>

                    {paneBackgroundMode === 'color' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                                type="color"
                                value={paneBackground}
                                onChange={(e) => onPaneBackgroundChange(e.target.value)}
                                style={{ border: 'none', width: '30px', height: '30px', cursor: 'pointer', padding: 0, backgroundColor: 'transparent' }}
                            />
                            <input
                                type="text"
                                value={paneBackground}
                                onChange={(e) => onPaneBackgroundChange(e.target.value)}
                                className="settings-input"
                                style={{ width: '80px', padding: '4px' }}
                            />
                        </div>
                    )}
                    {paneBackgroundMode === 'image' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                                type="text"
                                value={paneBackgroundImage}
                                onChange={(e) => onPaneBackgroundImageChange(e.target.value)}
                                placeholder="e.g. /my-background.jpg or media:///C:/path/to/image.png"
                                className="settings-input"
                                style={{ flex: 1, padding: '4px' }}
                            />
                            <button
                                onClick={async () => {
                                    const path = await electronService.selectImage();
                                    if (path) {
                                        const url = `media:///${path.replace(/\\/g, '/')}`;
                                        onPaneBackgroundImageChange(url);
                                    }
                                }}
                                style={{ padding: '4px 8px', cursor: 'pointer' }}
                            >
                                Browse...
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="form-group">
                <label>Font Family</label>
                <select
                    value={fontFamily}
                    onChange={(e) => onFontFamilyChange(e.target.value)}
                    className="settings-select"
                >
                    <option value='Consolas, "Courier New", monospace'>Consolas / Courier New</option>
                    <option value='"Cascadia Code", "Fira Code", monospace'>Cascadia / Fira Code</option>
                    <option value='"MesloLGS NF", "DejaVu Sans Mono", monospace'>MesloLGS NF / DejaVu</option>
                    <option value="monospace">System Monospace</option>
                </select>
            </div>

            <div className="form-group">
                <label>Font Size</label>
                <input
                    type="number"
                    value={fontSize}
                    onChange={(e) => onFontSizeChange(parseInt(e.target.value, 10))}
                    className="settings-input"
                    min={8}
                    max={72}
                />
            </div>

            <div className="form-group">
                <label>Default Encoding</label>
                <select
                    value={encoding}
                    onChange={(e) => onEncodingChange(e.target.value)}
                    className="settings-select"
                >
                    <option value="utf8">UTF-8</option>
                    <option value="shift_jis">Shift_JIS</option>
                    <option value="euc-jp">EUC-JP</option>
                </select>
                <p className="settings-help">Applies to new connections.</p>
            </div>

            <div className="form-group" style={{ paddingTop: '15px', borderTop: '1px solid var(--border-color)' }}>
                <label>Prompt Highlight</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal', whiteSpace: 'nowrap' }}>
                        <input
                            type="checkbox"
                            checked={enablePromptHighlight}
                            onChange={(e) => onEnablePromptHighlightChange(e.target.checked)}
                            style={{ marginRight: '8px' }}
                        />
                        Enable User Input Highlight
                    </label>
                </div>
                {enablePromptHighlight && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
                            <span style={{ color: '#ccc' }}>Highlight Color</span>
                            <input
                                type="color"
                                value={promptHighlightColor}
                                onChange={(e) => onPromptHighlightColorChange(e.target.value)}
                                style={{ border: 'none', width: '30px', height: '30px', cursor: 'pointer', padding: 0, backgroundColor: 'transparent' }}
                            />
                            <input
                                type="text"
                                value={promptHighlightColor}
                                onChange={(e) => onPromptHighlightColorChange(e.target.value)}
                                className="settings-input"
                                style={{ width: '120px', padding: '4px' }}
                            />
                        </div>
                        <label style={{ marginBottom: '10px', display: 'block' }}>Prompt Patterns (Regex)</label>
                        <div className="command-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                            {promptPatterns?.map((p, index) => (
                                <div
                                    key={p.id}
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '4px',
                                        padding: '10px',
                                        backgroundColor: 'var(--bg-secondary)',
                                        borderRadius: '4px',
                                        border: '1px solid var(--border-color)'
                                    }}
                                >
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <input
                                            type="checkbox"
                                            checked={p.enabled}
                                            onChange={(e) => {
                                                const newPatterns = [...promptPatterns];
                                                newPatterns[index] = { ...p, enabled: e.target.checked };
                                                onPromptPatternsChange(newPatterns);
                                            }}
                                            style={{ margin: 0, cursor: 'pointer' }}
                                        />
                                        <input
                                            type="text"
                                            value={p.name}
                                            onChange={(e) => {
                                                const newPatterns = [...promptPatterns];
                                                newPatterns[index] = { ...p, name: e.target.value };
                                                onPromptPatternsChange(newPatterns);
                                            }}
                                            placeholder="Pattern Name"
                                            className="settings-input"
                                            style={{ flex: 1, padding: '4px' }}
                                        />
                                        <button
                                            onClick={() => {
                                                if (confirm('Delete this pattern?')) {
                                                    const newPatterns = promptPatterns.filter((_, i) => i !== index);
                                                    onPromptPatternsChange(newPatterns);
                                                }
                                            }}
                                            style={{ padding: '4px 8px', cursor: 'pointer', backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '3px' }}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                    <input
                                        type="text"
                                        value={p.pattern}
                                        onChange={(e) => {
                                            const newPatterns = [...promptPatterns];
                                            newPatterns[index] = { ...p, pattern: e.target.value };
                                            onPromptPatternsChange(newPatterns);
                                        }}
                                        placeholder="Regex Pattern (e.g. ^[-_\w]+@[-_\w]+[>#]\s*)"
                                        className="settings-input"
                                        style={{ width: '100%', padding: '6px', boxSizing: 'border-box', fontFamily: 'monospace' }}
                                    />
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '10px', paddingBottom: '10px' }}>
                            <button
                                onClick={() => {
                                    const id = crypto.randomUUID();
                                    const newPattern = { id, name: 'New Pattern', pattern: '^pattern\\s*', enabled: true };
                                    onPromptPatternsChange([...(promptPatterns || []), newPattern]);
                                }}
                                style={{ padding: '6px 12px', cursor: 'pointer' }}
                            >
                                + Add Pattern
                            </button>
                        </div>
                    </>
                )}
            </div>
        </>
    );
};
