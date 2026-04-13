import { usePaneStore } from '../../stores/paneStore';
import { useSidebarLayoutStore, type SidebarEdge } from '../../stores/sidebarLayoutStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { LayoutMode } from '../../types/appTypes';
import './AppSidebar.css';

interface AppSidebarProps {
  onOpenSettings: () => void;
}

interface LayoutDef {
  mode: LayoutMode;
  title: string;
  lines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

const LAYOUT_DEFS: LayoutDef[] = [
  { mode: '1x1', title: 'Single (1x1)', lines: [] },
  {
    mode: '1x2',
    title: 'Split Vertical (1x2)',
    lines: [{ x1: 12, y1: 2, x2: 12, y2: 22 }],
  },
  {
    mode: '2x1',
    title: 'Split Horizontal (2x1)',
    lines: [{ x1: 2, y1: 12, x2: 22, y2: 12 }],
  },
  {
    mode: '2x2',
    title: 'Grid (2x2)',
    lines: [
      { x1: 12, y1: 2, x2: 12, y2: 22 },
      { x1: 2, y1: 12, x2: 22, y2: 12 },
    ],
  },
  {
    mode: '2x3',
    title: 'Grid (2x3)',
    lines: [
      { x1: 8.6, y1: 2, x2: 8.6, y2: 22 },
      { x1: 15.3, y1: 2, x2: 15.3, y2: 22 },
      { x1: 2, y1: 12, x2: 22, y2: 12 },
    ],
  },
  {
    mode: '3x2',
    title: 'Grid (3x2)',
    lines: [
      { x1: 12, y1: 2, x2: 12, y2: 22 },
      { x1: 2, y1: 8.6, x2: 22, y2: 8.6 },
      { x1: 2, y1: 15.3, x2: 22, y2: 15.3 },
    ],
  },
];

function LayoutIcon({ lines }: { lines: LayoutDef['lines'] }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="2" width="20" height="20" rx="2" />
      {lines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      ))}
    </svg>
  );
}

const EDGE_ICONS: Record<SidebarEdge, { title: string; line: { x1: number; y1: number; x2: number; y2: number } }> = {
  left: { title: 'Toggle Left Sidebar', line: { x1: 8, y1: 2, x2: 8, y2: 22 } },
  right: { title: 'Toggle Right Sidebar', line: { x1: 16, y1: 2, x2: 16, y2: 22 } },
  top: { title: 'Toggle Top Bar', line: { x1: 2, y1: 8, x2: 22, y2: 8 } },
  bottom: { title: 'Toggle Bottom Bar', line: { x1: 2, y1: 16, x2: 22, y2: 16 } },
};

function EdgeIcon({ edge }: { edge: SidebarEdge }) {
  const { line } = EDGE_ICONS[edge];
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function AppSidebar({ onOpenSettings }: AppSidebarProps) {
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
            title={def.title}
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
            title={EDGE_ICONS[edge].title}
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
          className={`app-sidebar-btn${lineWrapEnabled ? ' app-sidebar-btn-active' : ''}`}
          onClick={() => updateSetting('lineWrapEnabled', !lineWrapEnabled)}
          title={lineWrapEnabled ? 'Disable Line Wrap' : 'Enable Line Wrap'}
        >
          {lineWrapEnabled ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 10 4 15 9 20" />
              <path d="M20 4v7a4 4 0 0 1-4 4H4" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="app-sidebar-btn"
          onClick={onOpenSettings}
          title="Settings"
        >
          <SettingsIcon />
        </button>
      </div>
    </div>
  );
}
