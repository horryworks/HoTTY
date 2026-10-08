import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { tauriService } from '../../services/tauriService';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import type { LanguageId } from '../../types/appTypes';
import type { FixedSizeMode } from '../../utils/fixedTerminalSize';
import HelpTooltip from '../HelpTooltip/HelpTooltip';

export function GeneralTab() {
  const settings = useSettingsStore();
  const update = settings.update;
  const { t } = useTranslation();

  // The log folder path is saved when the field is left, not per keystroke.
  // Every save asks the user to approve the folder, so saving while typing
  // asked about the drive, then each folder on the way down, one dialog each,
  // and an OK on any of them approved a far wider folder than the one meant.
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const pathDraftRef = useRef(pathDraft);
  useEffect(() => { pathDraftRef.current = pathDraft; });
  const savePathDraft = () => {
    const draft = pathDraftRef.current;
    pathDraftRef.current = null;
    if (draft !== null && draft !== useSettingsStore.getState().loggingPath) {
      useSettingsStore.getState().update('loggingPath', draft);
    }
  };
  const commitPath = () => {
    savePathDraft();
    setPathDraft(null);
  };
  // Closing Settings while still in the field saves what was typed, as leaving it would.
  useEffect(() => savePathDraft, []);

  return (
    <>
      {/* ── Language ── */}
      <div className="settings-card">
        <h3 className="settings-section-title">{t('settings.general.languageSection')}</h3>
        <div className="settings-group">
          <label>
            {t('settings.general.languageLabel')}
            <HelpTooltip text={t('settings.general.languageHelp')} />
          </label>
          <select
            value={settings.language}
            onChange={(e) => update('language', e.target.value as LanguageId)}
          >
            {SUPPORTED_LANGUAGES.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Logging ── */}
      <div className="settings-card">
        <h3 className="settings-section-title">{t('settings.general.loggingSection')}</h3>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.loggingEnabled}
            onChange={(e) => update('loggingEnabled', e.target.checked)}
          />
          {t('settings.general.enableLogging')}
        </label>
        {settings.loggingEnabled && (
          <div className="settings-group">
            <label>
              {t('settings.general.logFolderPath')}
              <HelpTooltip text={t('settings.general.logFolderPathHelp')} />
            </label>
            <div className="settings-logging-path-row">
              <input
                type="text"
                value={pathDraft ?? settings.loggingPath}
                onChange={(e) => setPathDraft(e.target.value)}
                onBlur={commitPath}
                onKeyDown={(e) => { if (e.key === 'Enter') commitPath(); }}
                placeholder={t('settings.general.logFolderPathPlaceholder')}
              />
              <button
                type="button"
                onClick={async () => {
                  const path = await tauriService.selectFolder();
                  if (path) {
                    pathDraftRef.current = null;
                    setPathDraft(null);
                    update('loggingPath', path);
                  }
                }}
              >
                {t('common.browse')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Terminal ── */}
      <div className="settings-card">
        <h3 className="settings-section-title">{t('settings.general.terminalSection')}</h3>
        <div className="settings-group">
          <label>
            {t('settings.general.scrollbackBuffer')}
            <HelpTooltip text={t('settings.general.scrollbackHelp')} />
          </label>
          <input
            type="number"
            min={100}
            max={100000}
            value={settings.scrollback}
            onChange={(e) => update('scrollback', parseInt(e.target.value, 10) || 10000)}
          />
        </div>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.lineWrapEnabled}
            onChange={(e) => update('lineWrapEnabled', e.target.checked)}
          />
          {t('settings.general.enableLineWrap')}
        </label>
        <div className="settings-group">
          <label>
            {t('settings.general.fixedTerminalSizeMode')}
            <HelpTooltip text={t('settings.general.fixedTerminalSizeModeHelp')} />
          </label>
          <select
            value={settings.fixedTerminalSizeMode}
            onChange={(e) => update('fixedTerminalSizeMode', e.target.value as FixedSizeMode)}
          >
            <option value="off">{t('settings.general.fixedTerminalSizeModeOff')}</option>
            <option value="auto">{t('settings.general.fixedTerminalSizeModeAuto')}</option>
            <option value="on">{t('settings.general.fixedTerminalSizeModeOn')}</option>
          </select>
        </div>
      </div>

      {/* ── Input ── */}
      <div className="settings-card">
      <h3 className="settings-section-title">{t('settings.general.inputSection')}</h3>
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={settings.backspaceSendsDel}
          onChange={(e) => update('backspaceSendsDel', e.target.checked)}
        />
        {t('settings.general.backspaceSendsDel')}
        <HelpTooltip text={t('settings.general.backspaceSendsDelHelp')} />
      </label>
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={settings.rightClickPaste}
          onChange={(e) => update('rightClickPaste', e.target.checked)}
        />
        {t('settings.general.rightClickPaste')}
        <HelpTooltip text={t('settings.general.rightClickPasteHelp')} />
      </label>
      </div>

      {/* ── Diagnostics ── */}
      <div className="settings-card">
      <h3 className="settings-section-title">{t('settings.general.diagnosticsSection')}</h3>
      <div className="settings-group">
        <label>
          {t('settings.general.debugLog')}
          <HelpTooltip text={t('settings.general.debugLogHelp')} />
        </label>
        <div>
          <button
            type="button"
            className="settings-button"
            onClick={() => tauriService.openDebugLogFolder()}
          >
            {t('settings.general.openDebugLogFolder')}
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
