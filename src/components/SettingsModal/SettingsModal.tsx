import { useState } from 'react';
import { AboutTab } from './AboutTab';
import { AppearanceTab } from './AppearanceTab';
import { GeneralTab } from './GeneralTab';
import { ProtocolsTab } from './ProtocolsTab';
import { FeaturesTab } from './FeaturesTab';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'general' | 'appearance' | 'protocols' | 'features' | 'about';

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'protocols', label: 'Protocols' },
  { id: 'features', label: 'Features' },
  { id: 'about', label: 'About' },
];

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>('general');

  if (!open) return null;

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <span>Settings</span>
        </div>
        <div className="settings-modal-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`settings-modal-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="settings-modal-body">
          {tab === 'general' && <GeneralTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'protocols' && <ProtocolsTab />}
          {tab === 'features' && <FeaturesTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}
