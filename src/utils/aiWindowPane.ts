import { usePaneStore } from '../stores/paneStore';
import { getFeatureDisplayName, makeFeaturePaneId, type FeaturePaneInfo } from './paneTypes';
import { IS_AI_CHAT_WINDOW } from './windowLabel';

/**
 * Build the AI Chat pane descriptor a dedicated AI Chat window opens with.
 *
 * Pure — it only mints an id. {@link AI_WINDOW_INITIAL_PANE} is what actually
 * installs it.
 */
export function makeAiWindowPane(): FeaturePaneInfo {
  return {
    id: makeFeaturePaneId('ai-chat'),
    type: 'ai-chat',
    displayName: getFeatureDisplayName('ai-chat'),
  };
}

/**
 * The pane a dedicated AI Chat window starts with, or `null` in every other
 * window.
 *
 * Resolved at module load rather than from an effect, for two reasons. The pane
 * has to exist before the first render — an AI window with no pane is an empty
 * window, and creating it afterwards would flash. And the layout store is an
 * external store, so seeding it out here keeps React uninvolved: no setState in
 * an effect body (which the React Compiler rejects as a cascading render), and
 * StrictMode's double-mount is a non-event because this runs once per module,
 * not once per mount.
 *
 * The layout is pinned to 1x1 because an AI window renders no grid controls, so
 * no other slot is reachable there.
 *
 * Phase 2 replaces this fresh pane with the conversation handed over from the
 * window that opened us, reusing THAT conversation's pane id — the backend chat
 * history is keyed `paneId::tabId`, so the id has to travel with it.
 */
export const AI_WINDOW_INITIAL_PANE: FeaturePaneInfo | null = IS_AI_CHAT_WINDOW
  ? installAiWindowPane()
  : null;

function installAiWindowPane(): FeaturePaneInfo {
  const pane = makeAiWindowPane();
  const store = usePaneStore.getState();
  store.setLayoutMode('1x1');
  store.addSession(pane.id);
  return pane;
}
