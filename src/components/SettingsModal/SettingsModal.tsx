import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTabKeyboardNav } from '../../hooks/useTabKeyboardNav';
import { Dialog } from '../Dialog/Dialog';
import { ScrollStrip } from '../ScrollStrip/ScrollStrip';
import { AboutTab } from './AboutTab';
import { AISettingsTab } from './AISettingsTab';
import { AppearanceTab } from './AppearanceTab';
import { GeneralTab } from './GeneralTab';
import { ProtocolsTab } from './ProtocolsTab';
import { SshKeysTab } from './SshKeysTab';
import { FeaturesTab } from './FeaturesTab';
import { NetboxTab } from './NetboxTab';
import { VersionsTab } from './VersionsTab';
import type { Theme } from '../../types/appTypes';
import './SettingsModal.css';

export type SettingsTab =
  | 'general'
  | 'appearance'
  | 'protocols'
  | 'sshKeys'
  | 'features'
  | 'netbox'
  | 'ai'
  | 'versions'
  | 'about';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  themesData: Record<string, Theme>;
  onOpenCustomThemeCreator: () => void;
  onDeleteTheme: (themeKey: string) => Promise<void>;
  /** Tab to show when the modal opens (deep link, e.g. AI Chat → 'ai'). */
  initialTab?: SettingsTab;
}

/**
 * Fixed, not content-sized: letting each tab set the height made the dialog
 * jump on every tab change. The body scrolls when a tab needs more, and a short
 * tab simply has space below it. Both are quieter than resizing on every click,
 * and the user can drag the dialog to whatever suits them.
 *
 * Kept in step with `.settings-modal` in the stylesheet.
 */
const DEFAULT_SIZE = { width: 520, height: 600 };
/** Narrower and the tab strip is more arrows than tabs; shorter and the body shows nothing useful. */
const MIN_SIZE = { width: 420, height: 320 };

const TAB_IDS: SettingsTab[] = [
  'general',
  'appearance',
  'protocols',
  'sshKeys',
  'features',
  'netbox',
  'ai',
  'versions',
  'about',
];

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

  // The tab strip outgrew the modal's 520px, so it scrolls rather than the
  // dialog widening (every other tab is laid out for 520px).
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const { onKeyDown: onTabKeyDown } = useTabKeyboardNav({
    ids: TAB_IDS,
    activeId: tab,
    onSelect: (id) => setTab(id as SettingsTab),
  });

  // The component stays mounted while closed, so apply the requested tab on
  // each open transition (render-time state adjustment, not an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && initialTab) setTab(initialTab);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('settings.title')}
      className="settings-modal"
      geometry={{ persistKey: 'settings', defaultSize: DEFAULT_SIZE, minSize: MIN_SIZE }}
      subheader={
        <ScrollStrip
          className="settings-modal-tabs"
          wrapClassName="settings-modal-tabs-wrap"
          role="tablist"
          // Focusable so the arrow keys reach onTabKeyDown; without it a click
          // on a tab leaves focus on the button and Left/Right would scroll the
          // strip instead of changing tab.
          tabIndex={0}
          ariaLabel={t('settings.title')}
          onKeyDown={onTabKeyDown}
          // Keeps a deep-linked tab visible (AI Chat opens 'ai', the update
          // toast opens 'versions'): an invisible "selected" tab reads as the
          // wrong tab being open.
          activeChildRef={activeTabRef}
          revealKey={tab}
        >
          {TAB_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              ref={tab === id ? activeTabRef : undefined}
              className={`settings-modal-tab${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {t(`settings.tabs.${id}`)}
            </button>
          ))}
        </ScrollStrip>
      }
    >
      {tab === 'general' && <GeneralTab />}
      {tab === 'appearance' && (
        <AppearanceTab
          themesData={themesData}
          onOpenCustomThemeCreator={onOpenCustomThemeCreator}
          onDeleteTheme={onDeleteTheme}
        />
      )}
      {tab === 'protocols' && <ProtocolsTab />}
      {tab === 'sshKeys' && <SshKeysTab />}
      {tab === 'features' && <FeaturesTab />}
      {tab === 'netbox' && <NetboxTab />}
      {tab === 'ai' && <AISettingsTab />}
      {tab === 'versions' && <VersionsTab />}
      {tab === 'about' && <AboutTab />}
    </Dialog>
  );
}
