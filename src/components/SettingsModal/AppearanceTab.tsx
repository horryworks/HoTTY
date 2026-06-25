import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useSettingsStore, DEFAULT_PROMPT_PATTERNS } from '../../stores/settingsStore';
import { DEFAULT_THEMES, DEFAULT_THEME_IDS, isBuiltInThemeId } from '../../themes/defaults';
import { tauriService } from '../../services/tauriService';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import HelpTooltip from '../HelpTooltip/HelpTooltip';
import type { Encoding, PromptPattern, Theme } from '../../types/appTypes';

interface AppearanceTabProps {
  themesData: Record<string, Theme>;
  onOpenCustomThemeCreator: () => void;
  onDeleteTheme: (themeKey: string) => Promise<void>;
}

const FONT_CACHE_KEY = 'hotty-system-fonts-cache';

function isMonospace(fontName: string): boolean {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;
  ctx.font = `16px "${fontName}"`;
  return ctx.measureText('W').width === ctx.measureText('i').width;
}

export function AppearanceTab({ themesData, onOpenCustomThemeCreator, onDeleteTheme }: AppearanceTabProps) {
  const settings = useSettingsStore();
  const update = settings.update;
  const { t } = useTranslation();

  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [fontScanning, setFontScanning] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const themeKeys = Object.keys(themesData);
  const builtInKeys = DEFAULT_THEME_IDS.filter((k) => k in themesData);
  const customKeys = themeKeys
    .filter((k) => !isBuiltInThemeId(k))
    .sort((a, b) => a.localeCompare(b));
  const orderedThemeKeys = [...builtInKeys, ...customKeys];
  const currentIsCustom = !isBuiltInThemeId(settings.theme) && settings.theme in themesData;

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
      {/* ── Layout ── */}
      <div className="settings-card">
        <h3 className="settings-section-title settings-section-title--first">{t('settings.appearance.layoutSection')}</h3>
        <div className="settings-group">
          <label>{t('settings.appearance.sidebarPosition')}</label>
          <div className="settings-radio-row">
            {(['left', 'right'] as const).map((pos) => (
              <label key={pos}>
                <input
                  type="radio"
                  checked={settings.sidebarPosition === pos}
                  onChange={() => update('sidebarPosition', pos)}
                />
                {pos === 'left'
                  ? t('settings.appearance.sidebarLeft')
                  : t('settings.appearance.sidebarRight')}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ── Theme ── */}
      <div className="settings-card">
        <h3 className="settings-section-title">{t('settings.appearance.themeSection')}</h3>
        <div className="settings-group">
        <label>{t('settings.appearance.themeLabel')}</label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={settings.theme}
            onChange={(e) => update('theme', e.target.value)}
            style={{ flex: 1 }}
          >
            {orderedThemeKeys.map((id) => {
              const label = themesData[id]?.name
                ?? (isBuiltInThemeId(id) ? DEFAULT_THEMES[id].name : id);
              return (
                <option key={id} value={id}>
                  {label}
                </option>
              );
            })}
          </select>
          {currentIsCustom && (
            <button
              type="button"
              onClick={() => setPendingDelete(settings.theme)}
              style={{
                padding: '5px 10px',
                background: 'var(--btn-danger-bg)',
                color: 'var(--text-primary)',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {t('settings.appearance.deleteTheme')}
            </button>
          )}
        </div>
        <button
          type="button"
          className="settings-button"
          onClick={onOpenCustomThemeCreator}
        >
          {t('settings.appearance.createCustomTheme')}
        </button>
        </div>

        {/* ── Unused Pane Background ── */}
        <div className="settings-group">
          <label>{t('settings.appearance.unusedPaneBackground')}</label>
        <div className="settings-radio-row">
          {(['color', 'image'] as const).map((mode) => (
            <label key={mode}>
              <input
                type="radio"
                checked={settings.paneBackgroundMode === mode}
                onChange={() => update('paneBackgroundMode', mode)}
              />
              {mode === 'color'
                ? t('settings.appearance.paneBackgroundColor')
                : t('settings.appearance.paneBackgroundImage')}
            </label>
          ))}
        </div>
        {settings.paneBackgroundMode === 'color' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
            <input
              type="color"
              value={settings.paneBackground}
              onChange={(e) => update('paneBackground', e.target.value)}
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
              value={settings.paneBackground}
              onChange={(e) => update('paneBackground', e.target.value)}
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
        )}
        {settings.paneBackgroundMode === 'image' && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <input
              type="text"
              value={settings.paneBackgroundImage}
              onChange={(e) => update('paneBackgroundImage', e.target.value)}
              placeholder={t('settings.appearance.paneBackgroundImagePlaceholder')}
              className="settings-input"
              style={{
                flex: 1,
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
            <button
              type="button"
              onClick={async () => {
                const path = await tauriService.selectImage();
                if (path) update('paneBackgroundImage', convertFileSrc(path));
              }}
            >
              {t('settings.appearance.browse')}
            </button>
            {settings.paneBackgroundImage && (
              <button
                type="button"
                onClick={() => update('paneBackgroundImage', '')}
                title={t('settings.appearance.clearImage')}
              >
                {t('settings.appearance.clear')}
              </button>
            )}
          </div>
        )}
        </div>
      </div>
      {pendingDelete && (
        <ConfirmModal
          title={t('settings.appearance.deleteThemeTitle')}
          message={t('settings.appearance.deleteThemeMessage', {
            name: themesData[pendingDelete]?.name ?? pendingDelete,
          })}
          confirmLabel={t('settings.appearance.deleteTheme')}
          onConfirm={async () => {
            const key = pendingDelete;
            setPendingDelete(null);
            await onDeleteTheme(key);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {/* ── Font ── */}
      <div className="settings-card">
        <h3 className="settings-section-title">{t('settings.appearance.fontSection')}</h3>
        <div className="settings-group">
        <label>{t('settings.appearance.fontFamily')}</label>
        <div className="settings-font-row">
          <select
            value={settings.fontFamily}
            onChange={(e) => update('fontFamily', e.target.value)}
            disabled={fontScanning}
          >
            <option value="monospace">{t('settings.appearance.systemMonospaceDefault')}</option>
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
            {fontScanning ? t('settings.appearance.scanning') : t('settings.appearance.rescan')}
          </button>
        </div>
        </div>

        {/* ── Font Size ── */}
        <div className="settings-group">
          <label>{t('settings.appearance.fontSize')}</label>
          <input
            type="number"
            min={8}
            max={48}
            value={settings.fontSize}
            onChange={(e) => update('fontSize', parseInt(e.target.value, 10) || 14)}
          />
        </div>
      </div>

      {/* ── Terminal Display ── */}
      <div className="settings-card">
        <h3 className="settings-section-title">{t('settings.appearance.terminalDisplaySection')}</h3>

        {/* ── Default Encoding ── */}
        <div className="settings-group">
          <label>
            {t('settings.appearance.defaultEncoding')}
            <HelpTooltip text={t('settings.appearance.defaultEncodingHelp')} />
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
        <div className="settings-group">
          <label>{t('settings.appearance.promptHighlight')}</label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.enablePromptHighlight}
            onChange={(e) => update('enablePromptHighlight', e.target.checked)}
          />
          {t('settings.appearance.enableUserInputHighlight')}
        </label>
        {settings.enablePromptHighlight && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 'calc(var(--font-size-base) - 1px)' }}>
                {t('settings.appearance.highlightColor')}
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
              {t('settings.appearance.promptPatternsRegex')}
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
                    placeholder={t('settings.appearance.namePlaceholder')}
                    style={{
                      width: '140px',
                      padding: '5px 8px',
                      flexShrink: 0,
                      background: 'var(--input-bg)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--ui-font-family)',
                      fontSize: 'calc(var(--font-size-base) - 1px)',
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
                    placeholder={t('settings.appearance.regexPlaceholder')}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      fontFamily: 'var(--font-family)',
                      fontSize: 'calc(var(--font-size-base) - 1px)',
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
                className="settings-button"
                onClick={() => {
                  const id = crypto.randomUUID();
                  const newPattern: PromptPattern = { id, name: 'New Pattern', pattern: '^pattern\\s*' };
                  update('promptPatterns', [...(settings.promptPatterns || []), newPattern]);
                }}
              >
                {t('settings.appearance.addPattern')}
              </button>
              <button
                type="button"
                className="settings-button"
                onClick={() => {
                  update('promptPatterns', DEFAULT_PROMPT_PATTERNS);
                }}
              >
                {t('settings.appearance.resetToDefault')}
              </button>
            </div>
          </>
        )}
        </div>
      </div>
    </>
  );
}
