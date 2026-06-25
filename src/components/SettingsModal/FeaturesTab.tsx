import { useTranslation } from 'react-i18next';
import type { FeatureId } from '../../types/appTypes';
import { useSettingsStore } from '../../stores/settingsStore';
import HelpTooltip from '../HelpTooltip/HelpTooltip';

// Stable translation key references per feature. Labels/descriptions are
// resolved via t() inside the component so they react to language changes.
const FEATURE_KEYS: { id: FeatureId; labelKey: string; descriptionKey: string }[] = [
  { id: 'ai-chat', labelKey: 'settings.features.aiChatLabel', descriptionKey: 'settings.features.aiChatDescription' },
  { id: 'log-viewer', labelKey: 'settings.features.logViewerLabel', descriptionKey: 'settings.features.logViewerDescription' },
  { id: 'ping-monitor', labelKey: 'settings.features.pingMonitorLabel', descriptionKey: 'settings.features.pingMonitorDescription' },
  { id: 'text-editor', labelKey: 'settings.features.textEditorLabel', descriptionKey: 'settings.features.textEditorDescription' },
  { id: 'file-explorer', labelKey: 'settings.features.fileExplorerLabel', descriptionKey: 'settings.features.fileExplorerDescription' },
  { id: 'file-server', labelKey: 'settings.features.fileServerLabel', descriptionKey: 'settings.features.fileServerDescription' },
];

export function FeaturesTab() {
  const { t } = useTranslation();
  const enabledFeatures = useSettingsStore((s) => s.enabledFeatures);
  const update = useSettingsStore((s) => s.update);

  const handleToggle = (id: FeatureId, enabled: boolean) => {
    update('enabledFeatures', { ...enabledFeatures, [id]: enabled });
  };

  return (
    <>
      <div className="settings-card">
        <h3 className="settings-section-title">
          {t('settings.features.section')}
          <HelpTooltip text={t('settings.features.sectionHelp')} />
        </h3>
        {FEATURE_KEYS.map(({ id, labelKey, descriptionKey }) => (
          <label key={id} className="settings-checkbox" title={t(descriptionKey)}>
            <input
              type="checkbox"
              checked={enabledFeatures[id]}
              onChange={(e) => handleToggle(id, e.target.checked)}
            />
            {t(labelKey)}
          </label>
        ))}
      </div>
    </>
  );
}
