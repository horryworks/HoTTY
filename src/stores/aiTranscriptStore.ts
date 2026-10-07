import { create } from 'zustand';
import type { ChatImage } from '../types/appTypes';
import type { AutoExecState, AutoExecBlock } from '../utils/autoExecReducer';

/**
 * The AI Chat transcripts of this window, OUTSIDE the pane component.
 *
 * An AI Chat pane is re-created by React whenever it changes parent: dragged to
 * another grid cell, hidden by a layout switch or a sidebar toggle, then shown
 * again. While the transcript lived in the pane's own state, every one of those
 * wiped the conversation — the answer in flight was dropped, and the Network
 * Expert, seeing an empty chat, identified the device all over again.
 * Terminals never had this problem: their xterm lives in the session record.
 * So the transcript now lives here, keyed by pane id, and the pane is a view.
 *
 * Not persisted and per window: a conversation moves between windows through
 * the handover (`exportPane` / `importPane`), never through storage.
 */

export interface ChatMessage {
    role: 'user' | 'model';
    content: string;
    /** Image attachments on a user turn (input-only; assistant turns never have them). */
    images?: ChatImage[];
}

/** Running token/cost totals for one tab (cost is null until a priced model reports usage). */
export interface TabTokens {
    input: number;
    output: number;
    cost: number | null;
}

/** One tab's transcript and token totals in wire form (Maps do not survive JSON). */
export type TranscriptEntries = [tabId: string, messages: ChatMessage[]][];
export type TokenEntries = [tabId: string, tokens: TabTokens][];
/** Commands that already ran or were declined, per tab, in wire form. */
export type OutcomeEntries = [tabId: string, blocks: [blockKey: string, block: AutoExecBlock][]][];

export interface PaneTranscripts {
    /** Finished turns, per tab. */
    messagesByTab: ReadonlyMap<string, ChatMessage[]>;
    /** The partial answer still streaming in, per tab. */
    streamingByTab: ReadonlyMap<string, string>;
    /** Tabs with an answer in flight. */
    streamingTabIds: ReadonlySet<string>;
    tokensByTab: ReadonlyMap<string, TabTokens>;
    /** Commands that already ran or were declined (see `terminalOutcomes`). Kept
     *  here so a re-created pane does not offer Run again on a command that ran. */
    outcomesByTab: AutoExecState;
}

export const EMPTY_PANE: PaneTranscripts = {
    messagesByTab: new Map(),
    streamingByTab: new Map(),
    streamingTabIds: new Set(),
    tokensByTab: new Map(),
    outcomesByTab: new Map(),
};

interface AiTranscriptState {
    panes: ReadonlyMap<string, PaneTranscripts>;
    /** Replace one pane's transcripts (creating the pane). The updater gets the
     *  current value, or {@link EMPTY_PANE} for a pane not seen before. */
    updatePane: (paneId: string, updater: (pane: PaneTranscripts) => PaneTranscripts) => void;
    /** Install transcripts that arrived from another window, wholesale. */
    importPane: (paneId: string, messages: TranscriptEntries, tokens: TokenEntries, outcomes?: OutcomeEntries) => void;
    /** Snapshot a pane's finished turns, token totals and command outcomes for a handover. */
    exportPane: (paneId: string) => { messages: TranscriptEntries; tokens: TokenEntries; outcomes: OutcomeEntries };
    /** Drop a pane (closed, or handed over to another window). */
    removePane: (paneId: string) => void;
}

export const useAiTranscriptStore = create<AiTranscriptState>((set, get) => ({
    panes: new Map(),

    updatePane: (paneId, updater) =>
        set((s) => {
            const cur = s.panes.get(paneId) ?? EMPTY_PANE;
            const next = updater(cur);
            if (next === cur) return s;
            const panes = new Map(s.panes);
            panes.set(paneId, next);
            return { panes };
        }),

    importPane: (paneId, messages, tokens, outcomes = []) =>
        set((s) => {
            const panes = new Map(s.panes);
            panes.set(paneId, {
                ...EMPTY_PANE,
                messagesByTab: new Map(messages),
                tokensByTab: new Map(tokens),
                outcomesByTab: new Map(outcomes.map(([tabId, blocks]) => [tabId, new Map(blocks)])),
            });
            return { panes };
        }),

    exportPane: (paneId) => {
        const pane = get().panes.get(paneId) ?? EMPTY_PANE;
        return {
            messages: Array.from(pane.messagesByTab.entries()),
            tokens: Array.from(pane.tokensByTab.entries()),
            outcomes: Array.from(pane.outcomesByTab, ([tabId, blocks]) => [tabId, Array.from(blocks.entries())]),
        };
    },

    removePane: (paneId) =>
        set((s) => {
            if (!s.panes.has(paneId)) return s;
            const panes = new Map(s.panes);
            panes.delete(paneId);
            return { panes };
        }),
}));

/** The transcripts of one pane right now (a plain read, for event handlers and timers). */
export function paneTranscripts(paneId: string): PaneTranscripts {
    return useAiTranscriptStore.getState().panes.get(paneId) ?? EMPTY_PANE;
}
