import { useState, type MouseEvent } from 'react';
import { TabWatchMenu, type TabWatchMenuState } from './TabWatchMenu';
import type { ConversationSummary } from './tabBarHelpers';

interface WatchPickerOptions {
  conversations: ConversationSummary[];
  onToggleWatch?: (id: string) => void;
  onWatchInConversation?: (sessionId: string, target: string | 'new') => void;
}

/**
 * What a press on the AI link button does: with one conversation (or none) it
 * toggles the link; with two or more the destination is ambiguous, so it opens
 * the "Watch in ▸" picker instead of silently attaching to the active one.
 * Shared by the tab list and the terminal pane header.
 */
export function useWatchPicker({ conversations, onToggleWatch, onWatchInConversation }: WatchPickerOptions) {
  const [menu, setMenu] = useState<TabWatchMenuState | null>(null);

  const onWatchClick = onToggleWatch
    ? (e: MouseEvent, sessionId: string, ownerTabId?: string) => {
        if (conversations.length >= 2 && onWatchInConversation) {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ sessionId, ownerTabId, x: r.left, y: r.bottom + 2, anchorTop: r.top });
        } else {
          onToggleWatch(sessionId);
        }
      }
    : undefined;

  const menuElement =
    menu && onWatchInConversation ? (
      <TabWatchMenu
        menu={menu}
        conversations={conversations}
        onWatchInConversation={onWatchInConversation}
        onClose={() => setMenu(null)}
      />
    ) : null;

  return { onWatchClick, menuElement };
}
