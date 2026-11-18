import { useTranslation } from 'react-i18next';
import type { SessionRecord } from '../../hooks/useSessionManager';
import { PaneHeader } from '../PaneHeader/PaneHeader';
import { sessionDetail, type ConversationSummary } from '../TabBar/tabBarHelpers';
import { WatchButton } from '../TabBar/WatchButton';
import { useWatchPicker } from '../TabBar/useWatchPicker';
import './TerminalPaneHeader.css';

interface TerminalPaneHeaderProps {
  paneId: string;
  paneNumber: number | null;
  session: Pick<SessionRecord, 'id' | 'displayName' | 'protocol' | 'connectionConfig'>;
  /** The AI Chat conversation watching this terminal, if any. */
  watch?: { colorIndex?: number; ownerTabId?: string };
  onClose: (id: string) => void;
  /** Present only when AI Chat is available. */
  onToggleWatch?: (id: string) => void;
  conversations?: ConversationSummary[];
  onWatchInConversation?: (sessionId: string, target: string | 'new') => void;
  /** Present only when the terminal's host has an enable password saved. */
  onSendEnablePassword?: () => void;
}

/**
 * A terminal pane's one-line header: the pane mark, the session name, what it
 * is connected to, then the enable-password and AI link buttons and the close
 * button. A terminal has no toolbar of its own, so the mark gets this row
 * instead of being laid over the terminal text.
 */
export function TerminalPaneHeader({
  paneId,
  paneNumber,
  session,
  watch,
  onClose,
  onToggleWatch,
  conversations = [],
  onWatchInConversation,
  onSendEnablePassword,
}: TerminalPaneHeaderProps) {
  const { t } = useTranslation();
  const { onWatchClick, menuElement } = useWatchPicker({ conversations, onToggleWatch, onWatchInConversation });
  const enableButton = onSendEnablePassword && (
    <button
      type="button"
      className="pane-term-enable"
      title={t('terminal.sendEnablePassword')}
      aria-label={t('terminal.sendEnablePassword')}
      // Keep keyboard focus in the terminal: the user types on right after.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onSendEnablePassword();
      }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="5" cy="8" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8.25 8H15M12.5 8v2.5M14.5 8v2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
  const watchButton = onWatchClick && (
    <WatchButton
      isWatching={!!watch}
      colorIndex={watch?.colorIndex}
      onClick={(e) => onWatchClick(e, session.id, watch?.ownerTabId)}
    />
  );
  return (
    <>
      <PaneHeader
        paneId={paneId}
        paneNumber={paneNumber}
        title={session.displayName}
        detail={sessionDetail(session)}
        actions={
          (enableButton || watchButton) && (
            <>
              {enableButton}
              {watchButton}
            </>
          )
        }
        onClose={() => onClose(session.id)}
        dragSessionId={session.id}
      />
      {menuElement}
    </>
  );
}
