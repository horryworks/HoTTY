import type { SessionRecord } from '../../hooks/useSessionManager';
import { usePromptDetection } from '../../hooks/usePromptDetection';
import { useSettingsStore } from '../../stores/settingsStore';
import { TerminalXtermHost } from './TerminalXtermHost';
import { TerminalMarkerRail } from './TerminalMarkerRail';
import { TerminalScrollbar } from './TerminalScrollbar';
import './Terminal.css';

interface TerminalViewProps {
  session: SessionRecord;
  active: boolean;
  onPasteRequest?: (sessionId: string) => void;
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
export function TerminalView({ session, active, onPasteRequest }: TerminalViewProps) {
  const rightClickPaste = useSettingsStore((s) => s.rightClickPaste);
  const enablePromptHighlight = useSettingsStore((s) => s.enablePromptHighlight);
  const promptHighlightColor = useSettingsStore((s) => s.promptHighlightColor);
  const promptPatterns = useSettingsStore((s) => s.promptPatterns);

  const markers = usePromptDetection(session.term, enablePromptHighlight, promptPatterns);

  const handleContextMenu = (e: React.MouseEvent) => {
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
    </div>
  );
}
