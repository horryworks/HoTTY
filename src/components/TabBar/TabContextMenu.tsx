import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMenuDismiss } from '../../hooks/useMenuDismiss';

export interface TabContextMenuState {
  tabId: string;
  kind: 'session' | 'feature';
  isWebBrowser: boolean;
  isSshOrTelnet: boolean;
  isWatching: boolean;
  fixedSize: boolean;
  /** Pinned width, if known (connect-time pty cols). Undefined hides the toggle. */
  ptyCols?: number;
  x: number;
  y: number;
}

interface TabContextMenuProps {
  menu: TabContextMenuState;
  onClose: () => void;
  onToggleWatch?: (id: string) => void;
  onWatchInAiWindow?: (id: string) => void;
  onSaveToHostTree?: (id: string) => void;
  onToggleFixedSize?: (id: string) => void;
  onBookmark?: (id: string) => void;
}

/** A tab's right-click menu. Opened only when at least one item applies. */
export function TabContextMenu({
  menu,
  onClose,
  onToggleWatch,
  onWatchInAiWindow,
  onSaveToHostTree,
  onToggleFixedSize,
  onBookmark,
}: TabContextMenuProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useMenuDismiss(true, [ref], onClose);

  const run = (fn: (id: string) => void) => () => {
    fn(menu.tabId);
    onClose();
  };

  return (
    <div ref={ref} className="tab-context-menu" style={{ top: menu.y, left: menu.x }} role="menu">
      {menu.kind === 'session' && onToggleWatch && (
        <div className="tab-context-menu-item" role="menuitem" onClick={run(onToggleWatch)}>
          {menu.isWatching ? t('chrome.tabBar.stopWatchAi') : t('chrome.tabBar.watchAi')}
        </div>
      )}
      {menu.kind === 'session' && onWatchInAiWindow && (
        <div className="tab-context-menu-item" role="menuitem" onClick={run(onWatchInAiWindow)}>
          {t('chrome.tabBar.watchInAiWindow')}
        </div>
      )}
      {menu.kind === 'session' && menu.isSshOrTelnet && onSaveToHostTree && (
        <div className="tab-context-menu-item" role="menuitem" onClick={run(onSaveToHostTree)}>
          {t('chrome.tabBar.saveToHostTree')}
        </div>
      )}
      {menu.kind === 'session' && menu.isSshOrTelnet && onToggleFixedSize && menu.ptyCols != null && (
        <div
          className="tab-context-menu-item"
          role="menuitemcheckbox"
          aria-checked={menu.fixedSize}
          onClick={run(onToggleFixedSize)}
        >
          {(menu.fixedSize ? '✓ ' : '') + t('chrome.tabBar.fixedTerminalSize', { cols: menu.ptyCols })}
        </div>
      )}
      {menu.isWebBrowser && onBookmark && (
        <div className="tab-context-menu-item" role="menuitem" onClick={run(onBookmark)}>
          {t('chrome.tabBar.bookmark')}
        </div>
      )}
    </div>
  );
}
