import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { tauriService } from '../../services/tauriService';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import type { LanguageId } from '../../types/appTypes';
import HelpTooltip from '../HelpTooltip/HelpTooltip';

export function GeneralTab() {
  const settings = useSettingsStore();
  const update = settings.update;
  const { t } = useTranslation();

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
                value={settings.loggingPath}
                onChange={(e) => update('loggingPath', e.target.value)}
                placeholder={t('settings.general.logFolderPathPlaceholder')}
              />
              <button
                type="button"
                onClick={async () => {
                  const path = await tauriService.selectFolder();
                  if (path) update('loggingPath', path);
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
