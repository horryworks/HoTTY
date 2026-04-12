const FEATURES = [
  { label: 'AI Chat', description: 'AI-powered chat panel for terminal assistance' },
  { label: 'Log Viewer', description: 'View and analyze session logs' },
  { label: 'Ping Monitor', description: 'Continuous ICMP ping monitoring' },
  { label: 'Text Editor', description: 'Built-in text file editor' },
  { label: 'File Explorer', description: 'Browse and manage files' },
];

export function FeaturesTab() {
  return (
    <>
      <div className="settings-group">
        <label>
          Features
          <span className="settings-help-text">
            Feature toggling coming in a future update.
          </span>
        </label>
      </div>
      {FEATURES.map(({ label, description }) => (
        <label key={label} className="settings-checkbox" title={description}>
          <input type="checkbox" checked disabled />
          {label}
        </label>
      ))}
    </>
  );
}
