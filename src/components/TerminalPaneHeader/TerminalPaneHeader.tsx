import type { SessionRecord } from '../../hooks/useSessionManager';
import { PaneHeader } from '../PaneHeader/PaneHeader';
import { sessionDetail, type ConversationSummary } from '../TabBar/tabBarHelpers';
import { WatchButton } from '../TabBar/WatchButton';
import { useWatchPicker } from '../TabBar/useWatchPicker';

interface TerminalPaneHeaderProps {
  paneId: string;
  session: Pick<SessionRecord, 'id' | 'displayName' | 'protocol' | 'connectionConfig'>;
  /** The AI Chat conversation watching this terminal, if any. */
  watch?: { colorIndex?: number; ownerTabId?: string };
  onClose: (id: string) => void;
  /** Present only when AI Chat is available. */
  onToggleWatch?: (id: string) => void;
  conversations?: ConversationSummary[];
  onWatchInConversation?: (sessionId: string, target: string | 'new') => void;
}

/**
 * A terminal pane's one-line header: the pane mark, the session name, what it
 * is connected to, then the AI link button and the close button. A terminal
 * has no toolbar of its own, so the mark gets this row instead of being laid
 * over the terminal text.
 */
export function TerminalPaneHeader({
  paneId,
  session,
  watch,
  onClose,
  onToggleWatch,
  conversations = [],
  onWatchInConversation,
}: TerminalPaneHeaderProps) {
  const { onWatchClick, menuElement } = useWatchPicker({ conversations, onToggleWatch, onWatchInConversation });
  return (
    <>
      <PaneHeader
        paneId={paneId}
        title={session.displayName}
        detail={sessionDetail(session)}
        actions={
          onWatchClick && (
            <WatchButton
              isWatching={!!watch}
              colorIndex={watch?.colorIndex}
              onClick={(e) => onWatchClick(e, session.id, watch?.ownerTabId)}
            />
          )
        }
        onClose={() => onClose(session.id)}
      />
      {menuElement}
    </>
  );
}
