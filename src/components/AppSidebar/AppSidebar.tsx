import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { usePaneStore } from '../../stores/paneStore';
import { useSidebarLayoutStore, type SidebarEdge } from '../../stores/sidebarLayoutStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { LayoutMode } from '../../types/appTypes';
import './AppSidebar.css';

interface AppSidebarProps {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

interface LayoutDef {
  mode: LayoutMode;
  titleKey: string;
  lines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

const LAYOUT_DEFS: LayoutDef[] = [
  { mode: '1x1', titleKey: 'chrome.appSidebar.layout.single', lines: [] },
  {
    mode: '1x2',
    titleKey: 'chrome.appSidebar.layout.splitVertical',
    lines: [{ x1: 12, y1: 2, x2: 12, y2: 22 }],
  },
  {
    mode: '2x1',
    titleKey: 'chrome.appSidebar.layout.splitHorizontal',
    lines: [{ x1: 2, y1: 12, x2: 22, y2: 12 }],
  },
  {
    mode: '2x2',
    titleKey: 'chrome.appSidebar.layout.grid2x2',
    lines: [
      { x1: 12, y1: 2, x2: 12, y2: 22 },
      { x1: 2, y1: 12, x2: 22, y2: 12 },
    ],
  },
  {
    mode: '2x3',
    titleKey: 'chrome.appSidebar.layout.grid2x3',
    lines: [
      { x1: 8.6, y1: 2, x2: 8.6, y2: 22 },
      { x1: 15.3, y1: 2, x2: 15.3, y2: 22 },
      { x1: 2, y1: 12, x2: 22, y2: 12 },
    ],
  },
  {
    mode: '3x2',
    titleKey: 'chrome.appSidebar.layout.grid3x2',
    lines: [
      { x1: 12, y1: 2, x2: 12, y2: 22 },
      { x1: 2, y1: 8.6, x2: 22, y2: 8.6 },
      { x1: 2, y1: 15.3, x2: 22, y2: 15.3 },
    ],
  },
];

function LayoutIcon({ lines }: { lines: LayoutDef['lines'] }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="20" height="20" rx="2" />
      {lines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      ))}
    </svg>
  );
}

const EDGE_ICONS: Record<SidebarEdge, { titleKey: string; line: { x1: number; y1: number; x2: number; y2: number } }> = {
  left: { titleKey: 'chrome.appSidebar.edge.left', line: { x1: 8, y1: 2, x2: 8, y2: 22 } },
  right: { titleKey: 'chrome.appSidebar.edge.right', line: { x1: 16, y1: 2, x2: 16, y2: 22 } },
  top: { titleKey: 'chrome.appSidebar.edge.top', line: { x1: 2, y1: 8, x2: 22, y2: 8 } },
  bottom: { titleKey: 'chrome.appSidebar.edge.bottom', line: { x1: 2, y1: 16, x2: 22, y2: 16 } },
};

function EdgeIcon({ edge }: { edge: SidebarEdge }) {
  const { line } = EDGE_ICONS[edge];
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function AppSidebar({ onOpenSettings, onOpenHelp }: AppSidebarProps) {
  const { t } = useTranslation();
  const layoutMode = usePaneStore((s) => s.layoutMode);
  const setLayoutMode = usePaneStore((s) => s.setLayoutMode);
  const sidebar = useSidebarLayoutStore();
  const position = useSettingsStore((s) => s.sidebarPosition);
  const lineWrapEnabled = useSettingsStore((s) => s.lineWrapEnabled);
  const updateSetting = useSettingsStore((s) => s.update);

  const edgeVisible = (edge: SidebarEdge): boolean =>
    edge === 'left'
      ? sidebar.showLeftSidebar
      : edge === 'right'
      ? sidebar.showRightSidebar
      : edge === 'top'
      ? sidebar.showTopBar
      : sidebar.showBottomBar;

  return (
    <div className={`app-sidebar${position === 'right' ? ' app-sidebar-right' : ''}`}>
      <div className="app-sidebar-top">
        {LAYOUT_DEFS.map((def) => (
          <div
            key={def.mode}
            className={`app-sidebar-btn${def.mode === layoutMode ? ' app-sidebar-btn-active' : ''}`}
            onClick={() => setLayoutMode(def.mode)}
            title={t(def.titleKey)}
            role="button"
            tabIndex={0}
          >
            <LayoutIcon lines={def.lines} />
          </div>
        ))}
        <div className="app-sidebar-separator" />
        {(['left', 'right', 'top', 'bottom'] as SidebarEdge[]).map((edge) => (
          <div
            key={edge}
            className={`app-sidebar-btn${edgeVisible(edge) ? ' app-sidebar-btn-active' : ''}`}
            onClick={() => sidebar.toggle(edge)}
            title={t(EDGE_ICONS[edge].titleKey)}
            role="button"
            tabIndex={0}
          >
            <EdgeIcon edge={edge} />
          </div>
        ))}
      </div>
      <div className="app-sidebar-bottom">
        <button
          type="button"
          className="app-sidebar-btn"
          onClick={() => {
            void tauriService.createWindow();
          }}
          title={`${t('chrome.appSidebar.newWindow')} (Ctrl+Shift+N)`}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="13" height="13" rx="2" />
            <line x1="20" y1="9" x2="20" y2="15" />
            <line x1="17" y1="12" x2="23" y2="12" />
          </svg>
        </button>
        <button
          type="button"
          className={`app-sidebar-btn${lineWrapEnabled ? ' app-sidebar-btn-active' : ''}`}
          onClick={() => updateSetting('lineWrapEnabled', !lineWrapEnabled)}
          title={lineWrapEnabled ? t('chrome.appSidebar.disableLineWrap') : t('chrome.appSidebar.enableLineWrap')}
        >
          {lineWrapEnabled ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 10 4 15 9 20" />
              <path d="M20 4v7a4 4 0 0 1-4 4H4" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="app-sidebar-btn"
          onClick={onOpenHelp}
          title={t('chrome.appSidebar.help')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
        <button
          type="button"
          className="app-sidebar-btn"
          onClick={onOpenSettings}
          title={t('chrome.appSidebar.settings')}
        >
          <SettingsIcon />
        </button>
      </div>
    </div>
  );
}
