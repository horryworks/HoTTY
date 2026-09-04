import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useResize } from '../../hooks/useResize';
import { useTabKeyboardNav } from '../../hooks/useTabKeyboardNav';
import { useSettingsStore } from '../../stores/settingsStore';
import { ScrollStrip } from '../ScrollStrip/ScrollStrip';
import { AboutTab } from './AboutTab';
import { AISettingsTab } from './AISettingsTab';
import { AppearanceTab } from './AppearanceTab';
import { GeneralTab } from './GeneralTab';
import { ProtocolsTab } from './ProtocolsTab';
import { FeaturesTab } from './FeaturesTab';
import { VersionsTab } from './VersionsTab';
import type { Theme } from '../../types/appTypes';
import './SettingsModal.css';

export type SettingsTab =
  | 'general'
  | 'appearance'
  | 'protocols'
  | 'features'
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

/** Below this the tab strip is more arrows than tabs. */
const MIN_WIDTH = 420;
/** Below this the body is too short to show anything useful. */
const MIN_HEIGHT = 320;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const TAB_IDS: SettingsTab[] = [
  'general',
  'appearance',
  'protocols',
  'features',
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

  // ── Resizable dialog ────────────────────────────────────────────────────
  const storedWidth = useSettingsStore((s) => s.settingsModalWidth);
  const storedHeight = useSettingsStore((s) => s.settingsModalHeight);
  const updateSetting = useSettingsStore((s) => s.update);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef({ w: 0, h: 0 });
  const dragResult = useRef<{ w: number; h: number } | null>(null);

  const { startResize, isResizing } = useResize({
    orientation: 'both',
    cursor: 'nwse-resize',
    onMove: (dx, dy) => {
      const el = modalRef.current;
      if (!el) return;
      const w = clamp(dragStart.current.w + dx, MIN_WIDTH, window.innerWidth * 0.9);
      const h = clamp(dragStart.current.h + dy, MIN_HEIGHT, window.innerHeight * 0.9);
      // Written straight to the node. Going through state would re-render the
      // dialog — and the whole active tab inside it — on every mousemove.
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      dragResult.current = { w, h };
    },
  });

  // Persist once, when the drag ends. Saving during the drag would rewrite the
  // entire settings blob to localStorage on every frame.
  useEffect(() => {
    if (isResizing || !dragResult.current) return;
    updateSetting('settingsModalWidth', dragResult.current.w);
    updateSetting('settingsModalHeight', dragResult.current.h);
    dragResult.current = null;
  }, [isResizing, updateSetting]);

  const handleResizeStart = (e: React.MouseEvent) => {
    const el = modalRef.current;
    if (!el) return;
    dragStart.current = { w: el.offsetWidth, h: el.offsetHeight };
    startResize(e);
  };

  const handleResizeReset = () => {
    // Clear what the drag wrote directly — React never knew about it, so
    // dropping the stored size alone would not undo it.
    const el = modalRef.current;
    if (el) {
      el.style.width = '';
      el.style.height = '';
    }
    dragResult.current = null;
    updateSetting('settingsModalWidth', null);
    updateSetting('settingsModalHeight', null);
  };

  const modalStyle =
    storedWidth != null && storedHeight != null
      ? { width: `${storedWidth}px`, height: `${storedHeight}px` }
      : undefined;

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
      <div
        className="settings-modal"
        ref={modalRef}
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <span>{t('settings.title')}</span>
        </div>
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
          {tab === 'versions' && <VersionsTab />}
          {tab === 'about' && <AboutTab />}
        </div>
        <div
          className="settings-modal-resize"
          onMouseDown={handleResizeStart}
          onDoubleClick={handleResizeReset}
          role="separator"
          aria-label={t('settings.resizeHint')}
          title={t('settings.resizeHint')}
        />
      </div>
    </div>
  );
}
