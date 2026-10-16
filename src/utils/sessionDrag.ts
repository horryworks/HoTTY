import { useUiOverlayStore } from '../stores/uiOverlayStore';

/** Marks a drag as carrying a tab id; panes and edge bars accept only these. */
export const SESSION_DRAG_TYPE = 'application/x-hotty-session';

/**
 * Starts dragging a tab (from a dock row or a pane header). The panes drop it
 * with `moveSessionToPane`.
 */
export function beginSessionDrag(dataTransfer: DataTransfer, sessionId: string): void {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(SESSION_DRAG_TYPE, sessionId);
  dataTransfer.setData('text/plain', sessionId);
  // Hide any Web Browser pane's native webview for the drag's duration so its
  // OS-composited window stops swallowing the pane drop target's DOM events.
  useUiOverlayStore.getState().setSessionDragging(true);
}

export function endSessionDrag(): void {
  useUiOverlayStore.getState().setSessionDragging(false);
}
