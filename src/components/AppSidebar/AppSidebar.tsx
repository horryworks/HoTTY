import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { usePaneStore } from '../../stores/paneStore';
import { useSidebarLayoutStore, type SidebarEdge } from '../../stores/sidebarLayoutStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { LayoutMode } from '../../types/appTypes';
import { DockMenu, type DockMenuPlacement } from '../Dock/DockMenu';
import './AppSidebar.css';

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface LayoutDef {
  mode: LayoutMode;
  titleKey: string;
  lines: Line[];
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

const EDGE_ICONS: Record<SidebarEdge, { titleKey: string; line: Line }> = {
  left: { titleKey: 'chrome.appSidebar.edge.left', line: { x1: 8, y1: 2, x2: 8, y2: 22 } },
  right: { titleKey: 'chrome.appSidebar.edge.right', line: { x1: 16, y1: 2, x2: 16, y2: 22 } },
  top: { titleKey: 'chrome.appSidebar.edge.top', line: { x1: 2, y1: 8, x2: 22, y2: 8 } },
  bottom: { titleKey: 'chrome.appSidebar.edge.bottom', line: { x1: 2, y1: 16, x2: 22, y2: 16 } },
};

const EDGES: SidebarEdge[] = ['left', 'right', 'top', 'bottom'];

/** A square with lines in it: the shape every layout and bar icon shares. */
function FrameIcon({ lines }: { lines: Line[] }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="2" />
      {lines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      ))}
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
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

interface AppSidebarTopProps {
  /**
   * Gather the six layout buttons and the four bar toggles into one button
   * each, which opens them in a small menu. Used when the dock is a row along
   * the top or bottom, where ten buttons would crowd out the tabs.
   */
  collapsed?: boolean;
  /** Which way those menus open. */
  menuPlacement?: DockMenuPlacement;
}

/** The upper group of the dock's icon column: pane layout and edge-bar toggles. */
export function AppSidebarTop({ collapsed = false, menuPlacement = 'down' }: AppSidebarTopProps) {
  const { t } = useTranslation();
  const layoutMode = usePaneStore((s) => s.layoutMode);
  const setLayoutMode = usePaneStore((s) => s.setLayoutMode);
  const showLeft = useSidebarLayoutStore((s) => s.showLeftSidebar);
  const showRight = useSidebarLayoutStore((s) => s.showRightSidebar);
  const showTop = useSidebarLayoutStore((s) => s.showTopBar);
  const showBottom = useSidebarLayoutStore((s) => s.showBottomBar);
  const toggleEdge = useSidebarLayoutStore((s) => s.toggle);
  const shown = { left: showLeft, right: showRight, top: showTop, bottom: showBottom };
  const [menu, setMenu] = useState<'layout' | 'edge' | null>(null);
  const layoutBtnRef = useRef<HTMLButtonElement>(null);
  const edgeBtnRef = useRef<HTMLButtonElement>(null);

  const layoutButtons = LAYOUT_DEFS.map((def) => (
    <button
      key={def.mode}
      type="button"
      className={`app-sidebar-btn${def.mode === layoutMode ? ' app-sidebar-btn-active' : ''}`}
      onClick={() => {
        setLayoutMode(def.mode);
        setMenu(null);
      }}
      title={t(def.titleKey)}
      aria-label={t(def.titleKey)}
      aria-pressed={def.mode === layoutMode}
    >
      <FrameIcon lines={def.lines} />
    </button>
  ));

  const edgeButtons = EDGES.map((edge) => (
    <button
      key={edge}
      type="button"
      className={`app-sidebar-btn${shown[edge] ? ' app-sidebar-btn-active' : ''}`}
      onClick={() => toggleEdge(edge)}
      title={t(EDGE_ICONS[edge].titleKey)}
      aria-label={t(EDGE_ICONS[edge].titleKey)}
      aria-pressed={shown[edge]}
    >
      <FrameIcon lines={[EDGE_ICONS[edge].line]} />
    </button>
  ));

  if (!collapsed) {
    return (
      <div className="app-sidebar-group app-sidebar-top">
        {layoutButtons}
        <div className="app-sidebar-separator" />
        {edgeButtons}
      </div>
    );
  }

  const current = LAYOUT_DEFS.find((d) => d.mode === layoutMode) ?? LAYOUT_DEFS[0];
  const shownEdges = EDGES.filter((e) => shown[e]);
  return (
    <div className="app-sidebar-group app-sidebar-top">
      <button
        ref={layoutBtnRef}
        type="button"
        className="app-sidebar-btn app-sidebar-btn-active"
        onClick={() => setMenu((m) => (m === 'layout' ? null : 'layout'))}
        title={t('chrome.dock.layoutMenu')}
        aria-label={t('chrome.dock.layoutMenu')}
        aria-haspopup="true"
        aria-expanded={menu === 'layout'}
      >
        <FrameIcon lines={current.lines} />
      </button>
      <button
        ref={edgeBtnRef}
        type="button"
        className={`app-sidebar-btn${shownEdges.length > 0 ? ' app-sidebar-btn-active' : ''}`}
        onClick={() => setMenu((m) => (m === 'edge' ? null : 'edge'))}
        title={t('chrome.dock.edgeMenu')}
        aria-label={t('chrome.dock.edgeMenu')}
        aria-haspopup="true"
        aria-expanded={menu === 'edge'}
      >
        <FrameIcon lines={shownEdges.map((e) => EDGE_ICONS[e].line)} />
      </button>
      <DockMenu
        open={menu === 'layout'}
        onClose={() => setMenu(null)}
        anchorRef={layoutBtnRef}
        placement={menuPlacement}
        className="dock-menu-row app-sidebar-menu"
        role="group"
        aria-label={t('chrome.dock.layoutMenu')}
      >
        {layoutButtons}
      </DockMenu>
      <DockMenu
        open={menu === 'edge'}
        onClose={() => setMenu(null)}
        anchorRef={edgeBtnRef}
        placement={menuPlacement}
        className="dock-menu-row app-sidebar-menu"
        role="group"
        aria-label={t('chrome.dock.edgeMenu')}
      >
        {edgeButtons}
      </DockMenu>
    </div>
  );
}

interface AppSidebarBottomProps {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

/** The lower group of the dock's icon column: window, wrap, help, settings. */
export function AppSidebarBottom({ onOpenSettings, onOpenHelp }: AppSidebarBottomProps) {
  const { t } = useTranslation();
  const lineWrapEnabled = useSettingsStore((s) => s.lineWrapEnabled);
  const updateSetting = useSettingsStore((s) => s.update);
  const wrapTitle = lineWrapEnabled ? t('chrome.appSidebar.disableLineWrap') : t('chrome.appSidebar.enableLineWrap');
  return (
    <div className="app-sidebar-group app-sidebar-bottom">
      <button
        type="button"
        className="app-sidebar-btn"
        onClick={() => {
          void tauriService.createWindow();
        }}
        title={`${t('chrome.appSidebar.newWindow')} (Ctrl+Shift+N)`}
        aria-label={t('chrome.appSidebar.newWindow')}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="13" height="13" rx="2" />
          <line x1="20" y1="9" x2="20" y2="15" />
          <line x1="17" y1="12" x2="23" y2="12" />
        </svg>
      </button>
      <button
        type="button"
        className={`app-sidebar-btn${lineWrapEnabled ? ' app-sidebar-btn-active' : ''}`}
        onClick={() => updateSetting('lineWrapEnabled', !lineWrapEnabled)}
        title={wrapTitle}
        aria-label={wrapTitle}
      >
        {lineWrapEnabled ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 10 4 15 9 20" />
            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        )}
      </button>
      <button type="button" className="app-sidebar-btn" onClick={onOpenHelp} title={t('chrome.appSidebar.help')} aria-label={t('chrome.appSidebar.help')}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
      <button type="button" className="app-sidebar-btn" onClick={onOpenSettings} title={t('chrome.appSidebar.settings')} aria-label={t('chrome.appSidebar.settings')}>
        <SettingsIcon />
      </button>
    </div>
  );
}
