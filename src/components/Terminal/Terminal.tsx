import { useState } from 'react';
import type { SessionRecord } from '../../hooks/useSessionManager';
import { usePromptDetection } from '../../hooks/usePromptDetection';
import { useSettingsStore } from '../../stores/settingsStore';
import { TerminalXtermHost } from './TerminalXtermHost';
import { TerminalMarkerRail } from './TerminalMarkerRail';
import { TerminalScrollbar } from './TerminalScrollbar';
import { TerminalContextMenu } from './TerminalContextMenu';
import { isRightClickOverSelection } from './selectionGeometry';
import './Terminal.css';

interface TerminalViewProps {
  session: SessionRecord;
  active: boolean;
  onPasteRequest?: (sessionId: string) => void;
  /** Invoked when the user submits a free-text Ask AI question for the selection. */
  onAskAiSubmit?: (sessionId: string, selection: string, question: string) => void;
}

interface AskAiMenuState {
  x: number;
  y: number;
  selection: string;
}

/**
 * Three-rail terminal layout:
 *
 *   [ xterm host (text + canvas) ][ marker rail 8px ][ scrollbar rail 10px ]
 *
 * Each rail is an absolutely-positioned child of `.terminal-view`, so the
 * marker and scrollbar stay anchored to the pane's right edge regardless of
 * the host's horizontal scroll position. This guarantees the policy:
 *   - Vertical scrollbar at the pane right edge
 *   - Marker immediately to the left of the scrollbar
 *   - Scrollbar / marker / text never overlap each other
 */
export function TerminalView({
  session,
  active,
  onPasteRequest,
  onAskAiSubmit,
}: TerminalViewProps) {
  const rightClickPaste = useSettingsStore((s) => s.rightClickPaste);
  const enablePromptHighlight = useSettingsStore((s) => s.enablePromptHighlight);
  const promptHighlightColor = useSettingsStore((s) => s.promptHighlightColor);
  const promptPatterns = useSettingsStore((s) => s.promptPatterns);

  const markers = usePromptDetection(session.term, enablePromptHighlight, promptPatterns);

  const [askAiMenu, setAskAiMenu] = useState<AskAiMenuState | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    const term = session.term;
    const selection = term.getSelection();

    // Right-click over the current selection opens the inline Ask AI input;
    // anywhere else falls through to the paste behavior. (Old Electron-era spec.)
    if (
      selection &&
      onAskAiSubmit &&
      isRightClickOverSelection(e.clientX, e.clientY, term)
    ) {
      e.preventDefault();
      setAskAiMenu({ x: e.clientX, y: e.clientY, selection });
      return;
    }

    if (!rightClickPaste) return;
    e.preventDefault();
    onPasteRequest?.(session.id);
  };

  return (
    <div
      className={`terminal-view${active ? ' active' : ''}`}
      onContextMenu={handleContextMenu}
    >
      <TerminalXtermHost session={session} active={active} />
      <TerminalMarkerRail
        term={session.term}
        markers={markers}
        highlightColor={promptHighlightColor}
      />
      <TerminalScrollbar term={session.term} />
      {askAiMenu && (
        <TerminalContextMenu
          x={askAiMenu.x}
          y={askAiMenu.y}
          onSubmit={(question) => onAskAiSubmit?.(session.id, askAiMenu.selection, question)}
          onClose={() => setAskAiMenu(null)}
        />
      )}
    </div>
  );
}
