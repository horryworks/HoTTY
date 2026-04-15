import { useSettingsStore } from '../../stores/settingsStore';
import { tauriService } from '../../services/tauriService';
import HelpTooltip from '../HelpTooltip/HelpTooltip';

export function GeneralTab() {
  const settings = useSettingsStore();
  const update = settings.update;

  return (
    <>
      {/* ── Logging ── */}
      <div className="settings-card">
        <h3 className="settings-section-title">Logging</h3>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.loggingEnabled}
            onChange={(e) => update('loggingEnabled', e.target.checked)}
          />
          Enable Logging
        </label>
        {settings.loggingEnabled && (
          <div className="settings-group">
            <label>
              Log Folder Path
              <HelpTooltip text="Logs are saved as YYYYMMDDHHMMSS-(Protocol)-(IP).txt" />
            </label>
            <div className="settings-logging-path-row">
              <input
                type="text"
                value={settings.loggingPath}
                onChange={(e) => update('loggingPath', e.target.value)}
                placeholder="Select a folder or type path..."
              />
              <button
                type="button"
                onClick={async () => {
                  const path = await tauriService.selectFolder();
                  if (path) update('loggingPath', path);
                }}
              >
                Browse...
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Terminal ── */}
      <div className="settings-card">
        <h3 className="settings-section-title">Terminal</h3>
        <div className="settings-group">
          <label>
            Scrollback Buffer
            <HelpTooltip text="Max lines to keep in memory per terminal (Default: 10000)." />
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
          Enable line wrap
        </label>
      </div>

      {/* ── Input ── */}
      <div className="settings-card">
      <h3 className="settings-section-title">Input</h3>
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={settings.backspaceSendsDel}
          onChange={(e) => update('backspaceSendsDel', e.target.checked)}
        />
        Backspace sends DEL (0x7F)
        <HelpTooltip text="If disabled, Backspace sends 0x08 (BS). Enable if your server expects 0x7F." />
      </label>
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={settings.rightClickPaste}
          onChange={(e) => update('rightClickPaste', e.target.checked)}
        />
        Right-click to paste
        <HelpTooltip text="Right-clicking the terminal shows the paste confirmation dialog." />
      </label>
      </div>

      {/* ── Diagnostics ── */}
      <div className="settings-card">
      <h3 className="settings-section-title">Diagnostics</h3>
      <div className="settings-group">
        <label>
          Debug Log
          <HelpTooltip text="Share the latest log file when reporting a bug." />
        </label>
        <div>
          <button
            type="button"
            className="settings-button"
            onClick={() => tauriService.openDebugLogFolder()}
          >
            Open Debug Log Folder
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
