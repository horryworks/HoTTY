import React from 'react';
import type { FeatureId } from '../../types/appTypes';

const FEATURE_LABELS: { id: FeatureId; label: string; description: string }[] = [
    { id: 'ai-chat', label: 'AI Chat', description: 'AI-powered chat panel for terminal assistance' },
    { id: 'log-viewer', label: 'Log Viewer', description: 'View and analyze session logs' },
    { id: 'ping-monitor', label: 'Ping Monitor', description: 'Continuous ICMP ping monitoring' },
    { id: 'text-editor', label: 'Text Editor', description: 'Built-in text file editor' },
    { id: 'file-explorer', label: 'File Explorer', description: 'Browse and manage files' },
];

interface FeaturesTabProps {
    enabledFeatures: Record<FeatureId, boolean>;
    onFeatureToggle: (feature: FeatureId, enabled: boolean) => void;
}

export const FeaturesTab: React.FC<FeaturesTabProps> = ({
    enabledFeatures,
    onFeatureToggle,
}) => {
    return (
        <div>
            <div className="form-group">
                <label>Features</label>
                <p className="settings-help" style={{ marginTop: 0 }}>Enable or disable feature panes. Existing open panes are not affected.</p>
            </div>
            {FEATURE_LABELS.map(({ id, label, description }) => (
                <div key={id} style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }} title={description}>
                        <input
                            type="checkbox"
                            checked={enabledFeatures[id]}
                            onChange={(e) => onFeatureToggle(id, e.target.checked)}
                            style={{ marginRight: '8px' }}
                        />
                        {label}
                    </label>
                </div>
            ))}
        </div>
    );
};
