import type { FeatureId } from '../../types/appTypes';
import { useSettingsStore } from '../../stores/settingsStore';
import HelpTooltip from '../HelpTooltip/HelpTooltip';

const FEATURE_LABELS: { id: FeatureId; label: string; description: string }[] = [
  { id: 'ai-chat', label: 'AI Chat', description: 'AI-powered chat panel for terminal assistance' },
  { id: 'log-viewer', label: 'Log Viewer', description: 'View and analyze session logs' },
  { id: 'ping-monitor', label: 'Ping Monitor', description: 'Continuous ICMP ping monitoring' },
  { id: 'text-editor', label: 'Text Editor', description: 'Built-in text file editor' },
  { id: 'file-explorer', label: 'File Explorer', description: 'Browse and manage files' },
];

export function FeaturesTab() {
  const enabledFeatures = useSettingsStore((s) => s.enabledFeatures);
  const update = useSettingsStore((s) => s.update);

  const handleToggle = (id: FeatureId, enabled: boolean) => {
    update('enabledFeatures', { ...enabledFeatures, [id]: enabled });
  };

  return (
    <>
      <div className="settings-group">
        <label>
          Features
          <HelpTooltip text="Enable or disable feature panes. Existing open panes are not affected." />
        </label>
      </div>
      {FEATURE_LABELS.map(({ id, label, description }) => (
        <label key={id} className="settings-checkbox" title={description}>
          <input
            type="checkbox"
            checked={enabledFeatures[id]}
            onChange={(e) => handleToggle(id, e.target.checked)}
          />
          {label}
        </label>
      ))}
    </>
  );
}
