import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AboutTab } from './AboutTab';
import { AISettingsTab } from './AISettingsTab';
import { AppearanceTab } from './AppearanceTab';
import { GeneralTab } from './GeneralTab';
import { ProtocolsTab } from './ProtocolsTab';
import { FeaturesTab } from './FeaturesTab';
import type { Theme } from '../../types/appTypes';
import './SettingsModal.css';

export type SettingsTab = 'general' | 'appearance' | 'protocols' | 'features' | 'ai' | 'about';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  themesData: Record<string, Theme>;
  onOpenCustomThemeCreator: () => void;
  onDeleteTheme: (themeKey: string) => Promise<void>;
  /** Tab to show when the modal opens (deep link, e.g. AI Chat → 'ai'). */
  initialTab?: SettingsTab;
}

const TAB_IDS: SettingsTab[] = ['general', 'appearance', 'protocols', 'features', 'ai', 'about'];

export function SettingsModal({
  open,
  onClose,
  themesData,
  onOpenCustomThemeCreator,
  onDeleteTheme,
  initialTab,
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general');
  const { t } = useTranslation();

  // The component stays mounted while closed, so apply the requested tab on
  // each open transition (render-time state adjustment, not an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && initialTab) setTab(initialTab);
  }

  if (!open) return null;

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <span>{t('settings.title')}</span>
        </div>
        <div className="settings-modal-tabs">
          {TAB_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`settings-modal-tab${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {t(`settings.tabs.${id}`)}
            </button>
          ))}
        </div>
        <div className="settings-modal-body">
          {tab === 'general' && <GeneralTab />}
          {tab === 'appearance' && (
            <AppearanceTab
              themesData={themesData}
              onOpenCustomThemeCreator={onOpenCustomThemeCreator}
              onDeleteTheme={onDeleteTheme}
            />
          )}
          {tab === 'protocols' && <ProtocolsTab />}
          {tab === 'features' && <FeaturesTab />}
          {tab === 'ai' && <AISettingsTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}
