import { useSettingsStore } from '../../stores/settingsStore';
import { DEFAULT_THEMES, DEFAULT_THEME_IDS } from '../../themes/defaults';
import type { ThemeId } from '../../types/appTypes';

export function AppearanceTab() {
  const settings = useSettingsStore();
  const update = settings.update;

  return (
    <>
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
      <div className="settings-group">
        <label>Font family</label>
        <input
          type="text"
          value={settings.fontFamily}
          onChange={(e) => update('fontFamily', e.target.value)}
        />
      </div>
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
    </>
  );
}
