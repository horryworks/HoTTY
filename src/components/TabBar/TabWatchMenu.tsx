import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMenuDismiss } from '../../hooks/useMenuDismiss';
import { conversationColorVar } from '../../utils/conversationColor';
import type { ConversationSummary } from './tabBarHelpers';

export interface TabWatchMenuState {
  /** Terminal session the "Watch in ▸" picker is acting on. */
  sessionId: string;
  /** The conversation tab currently watching it, if any (marked as owner). */
  ownerTabId?: string;
  x: number;
  y: number;
  /** Top of the button that opened it: the menu flips above it when there is
   *  no room below (a dock at the bottom edge). */
  anchorTop?: number;
}

const MARGIN = 4;

interface TabWatchMenuProps {
  menu: TabWatchMenuState;
  conversations: ConversationSummary[];
  onWatchInConversation: (sessionId: string, target: string | 'new') => void;
  onClose: () => void;
}

/** "Watch in ▸": which AI Chat conversation should watch this terminal. */
export function TabWatchMenu({ menu, conversations, onWatchInConversation, onClose }: TabWatchMenuProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useMenuDismiss(true, [ref], onClose);

  // Keep the whole menu on screen: the button may sit at the window's right
  // edge (a pane header's AI link) or at its bottom (a dock on the bottom edge).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = menu.y;
    if (top + h > vh - MARGIN && menu.anchorTop != null && menu.anchorTop - 2 - h >= MARGIN) {
      top = menu.anchorTop - 2 - h;
    }
    el.style.left = `${Math.max(MARGIN, Math.min(menu.x, vw - w - MARGIN))}px`;
    el.style.top = `${Math.max(MARGIN, Math.min(top, vh - h - MARGIN))}px`;
  }, [menu.x, menu.y, menu.anchorTop]);

  const pick = (target: string) => () => {
    onWatchInConversation(menu.sessionId, target);
    onClose();
  };

  return (
    <div ref={ref} className="tab-watch-menu" style={{ top: menu.y, left: menu.x }} role="menu">
      <div className="tab-watch-menu-title">{t('chrome.tabBar.watchInTitle')}</div>
      {conversations.map((c) => {
        const isOwner = c.id === menu.ownerTabId;
        return (
          <div
            key={c.id}
            className={`tab-watch-menu-item${isOwner ? ' owner' : ''}`}
            role="menuitemradio"
            aria-checked={isOwner}
            onClick={pick(c.id)}
          >
            <span className="tab-watch-menu-dot" style={{ background: conversationColorVar(c.colorIndex) }} />
            <span className="tab-watch-menu-label">{c.title}</span>
            {isOwner && <span className="tab-watch-menu-check">✓</span>}
          </div>
        );
      })}
      <div className="tab-watch-menu-item tab-watch-menu-new" role="menuitem" onClick={pick('new')}>
        <span className="tab-watch-menu-dot tab-watch-menu-plus" aria-hidden="true">+</span>
        <span className="tab-watch-menu-label">{t('chrome.tabBar.watchInNew')}</span>
      </div>
    </div>
  );
}
