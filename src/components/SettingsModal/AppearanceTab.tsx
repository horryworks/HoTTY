import { useCallback, useEffect, useState } from 'react';
import { useSettingsStore, DEFAULT_PROMPT_PATTERNS } from '../../stores/settingsStore';
import { DEFAULT_THEMES, DEFAULT_THEME_IDS } from '../../themes/defaults';
import { tauriService } from '../../services/tauriService';
import type { Encoding, PromptPattern, ThemeId } from '../../types/appTypes';

const FONT_CACHE_KEY = 'hotty-system-fonts-cache';

function isMonospace(fontName: string): boolean {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;
  ctx.font = `16px "${fontName}"`;
  return ctx.measureText('W').width === ctx.measureText('i').width;
}

export function AppearanceTab() {
  const settings = useSettingsStore();
  const update = settings.update;

  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [fontScanning, setFontScanning] = useState(false);

  const scanAndCacheFonts = useCallback(async () => {
    setFontScanning(true);
    try {
      const all = await tauriService.listSystemFonts();
      const monospace = all.map((f) => f.family).filter(isMonospace);
      setSystemFonts(monospace);
      localStorage.setItem(FONT_CACHE_KEY, JSON.stringify(monospace));
    } catch {
      // font scanning unavailable
    } finally {
      setFontScanning(false);
    }
  }, []);

  useEffect(() => {
    const cached = localStorage.getItem(FONT_CACHE_KEY);
    if (cached) {
      try {
        setSystemFonts(JSON.parse(cached));
        return;
      } catch {
        // corrupted cache — fall through to rescan
      }
    }
    scanAndCacheFonts();
  }, [scanAndCacheFonts]);

  return (
    <>
      {/* ── Sidebar Position ── */}
      <div className="settings-group">
        <label>Sidebar position</label>
        <div className="settings-radio-row">
          {(['left', 'right'] as const).map((pos) => (
            <label key={pos}>
              <input
                type="radio"
                checked={settings.sidebarPosition === pos}
                onChange={() => update('sidebarPosition', pos)}
              />
              {pos}
            </label>
          ))}
        </div>
      </div>

      {/* ── Theme ── */}
      <div className="settings-group">
        <label>Theme</label>
        <select
          value={settings.theme}
          onChange={(e) => update('theme', e.target.value as ThemeId)}
        >
          {DEFAULT_THEME_IDS.map((id) => (
            <option key={id} value={id}>
              {DEFAULT_THEMES[id].name}
            </option>
          ))}
        </select>
      </div>

      {/* ── Font Family ── */}
      <div className="settings-group">
        <label>Font family</label>
        <div className="settings-font-row">
          <select
            value={settings.fontFamily}
            onChange={(e) => update('fontFamily', e.target.value)}
            disabled={fontScanning}
          >
            <option value="monospace">System Monospace (default)</option>
            {systemFonts.map((font) => (
              <option key={font} value={`"${font}", monospace`}>
                {font}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(FONT_CACHE_KEY);
              scanAndCacheFonts();
            }}
            disabled={fontScanning}
          >
            {fontScanning ? 'Scanning...' : 'Rescan'}
          </button>
        </div>
      </div>

      {/* ── Font Size ── */}
      <div className="settings-group">
        <label>Font size (px)</label>
        <input
          type="number"
          min={8}
          max={48}
          value={settings.fontSize}
          onChange={(e) => update('fontSize', parseInt(e.target.value, 10) || 14)}
        />
      </div>

      {/* ── Default Encoding ── */}
      <div className="settings-group">
        <label>
          Default encoding
          <span className="settings-help-text">Applies to new connections.</span>
        </label>
        <div className="settings-radio-row">
          {(['utf8', 'shift_jis', 'euc-jp'] as Encoding[]).map((enc) => (
            <label key={enc}>
              <input
                type="radio"
                checked={settings.globalEncoding === enc}
                onChange={() => update('globalEncoding', enc)}
              />
              {enc}
            </label>
          ))}
        </div>
      </div>

      {/* ── Prompt Highlight ── */}
      <div
        className="settings-group"
        style={{ paddingTop: '15px', borderTop: '1px solid var(--border-color)' }}
      >
        <label>Prompt Highlight</label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.enablePromptHighlight}
            onChange={(e) => update('enablePromptHighlight', e.target.checked)}
          />
          Enable User Input Highlight
        </label>
        {settings.enablePromptHighlight && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 'calc(var(--font-size-base) - 1px)' }}>
                Highlight Color
              </span>
              <input
                type="color"
                value={settings.promptHighlightColor}
                onChange={(e) => update('promptHighlightColor', e.target.value)}
                style={{
                  border: 'none',
                  width: '30px',
                  height: '30px',
                  cursor: 'pointer',
                  padding: 0,
                  backgroundColor: 'transparent',
                }}
              />
              <input
                type="text"
                value={settings.promptHighlightColor}
                onChange={(e) => update('promptHighlightColor', e.target.value)}
                className="settings-input"
                style={{
                  width: '120px',
                  padding: '5px 8px',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-family)',
                  fontSize: 'var(--font-size-base)',
                  outline: 'none',
                }}
              />
            </div>
            <label
              style={{
                marginBottom: '10px',
                display: 'block',
                fontSize: 'calc(var(--font-size-base) - 1px)',
                color: 'var(--text-secondary)',
              }}
            >
              Prompt Patterns (Regex)
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
              {settings.promptPatterns?.map((p: PromptPattern, index: number) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                    padding: '6px 10px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => {
                      const newPatterns = [...settings.promptPatterns];
                      newPatterns[index] = { ...p, name: e.target.value };
                      update('promptPatterns', newPatterns);
                    }}
                    placeholder="Name"
                    style={{
                      width: '140px',
                      padding: '5px 8px',
                      flexShrink: 0,
                      background: 'var(--input-bg)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-family)',
                      fontSize: 'var(--font-size-base)',
                      outline: 'none',
                    }}
                  />
                  <input
                    type="text"
                    value={p.pattern}
                    onChange={(e) => {
                      const newPatterns = [...settings.promptPatterns];
                      newPatterns[index] = { ...p, pattern: e.target.value };
                      update('promptPatterns', newPatterns);
                    }}
                    placeholder="Regex"
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      fontFamily: 'var(--font-family)',
                      fontSize: 'var(--font-size-base)',
                      background: 'var(--input-bg)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const newPatterns = settings.promptPatterns.filter((_, i) => i !== index);
                      update('promptPatterns', newPatterns);
                    }}
                    style={{
                      padding: '4px 8px',
                      cursor: 'pointer',
                      backgroundColor: 'var(--btn-danger-bg)',
                      color: 'var(--text-primary)',
                      border: 'none',
                      borderRadius: '3px',
                      flexShrink: 0,
                    }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '10px', paddingBottom: '10px' }}>
              <button
                type="button"
                onClick={() => {
                  const id = crypto.randomUUID();
                  const newPattern: PromptPattern = { id, name: 'New Pattern', pattern: '^pattern\\s*' };
                  update('promptPatterns', [...(settings.promptPatterns || []), newPattern]);
                }}
                style={{ padding: '6px 12px', cursor: 'pointer' }}
              >
                + Add Pattern
              </button>
              <button
                type="button"
                onClick={() => {
                  update('promptPatterns', DEFAULT_PROMPT_PATTERNS);
                }}
                style={{ padding: '6px 12px', cursor: 'pointer' }}
              >
                Reset to Default
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
