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
    /** On a model turn: the terminal its untargeted commands (no `target=`) run
     *  on, fixed when the answer arrived. Without it the target was worked out
     *  afresh on every render, so a command written for one terminal moved to
     *  another once the first closed or another took the focus. */
    execTarget?: { sessionId: string; bindingKey?: string };
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
/** The Network Expert's prep record, per tab, in wire form (see {@link TabPrep}). */
export type PrepEntries = [tabId: string, devices: [sessionId: string, deviceId: string][], selfOpened: string[]][];

/**
 * Which watched terminals a conversation's Network Expert has already prepared
 * (device identified, paging off), so it never asks for that again.
 *
 * `devices` maps a session id to the device it was prepared as. `selfOpened`
 * lists the sessions the conversation's AI opened itself: those are recorded
 * so they are not prepared, but no prep message ever went out for them, so
 * they do not make a conversation count as one the kickoff has run in.
 */
export interface TabPrep {
    devices: ReadonlyMap<string, string>;
    selfOpened: ReadonlySet<string>;
}

export const EMPTY_PREP: TabPrep = { devices: new Map(), selfOpened: new Set() };

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
    /** The Network Expert's prep record. Kept here, not in the pane, because a
     *  re-created pane that forgot it prepared a terminal would prepare it again. */
    prepByTab: ReadonlyMap<string, TabPrep>;
}

export const EMPTY_PANE: PaneTranscripts = {
    messagesByTab: new Map(),
    streamingByTab: new Map(),
    streamingTabIds: new Set(),
    tokensByTab: new Map(),
    outcomesByTab: new Map(),
    prepByTab: new Map(),
};

interface AiTranscriptState {
    panes: ReadonlyMap<string, PaneTranscripts>;
    /** Replace one pane's transcripts (creating the pane). The updater gets the
     *  current value, or {@link EMPTY_PANE} for a pane not seen before. */
    updatePane: (paneId: string, updater: (pane: PaneTranscripts) => PaneTranscripts) => void;
    /** Install transcripts that arrived from another window, wholesale. */
    importPane: (paneId: string, messages: TranscriptEntries, tokens: TokenEntries, outcomes?: OutcomeEntries, prep?: PrepEntries) => void;
    /** Snapshot a pane's finished turns, token totals, command outcomes and prep record for a handover. */
    exportPane: (paneId: string) => { messages: TranscriptEntries; tokens: TokenEntries; outcomes: OutcomeEntries; prep: PrepEntries };
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

    importPane: (paneId, messages, tokens, outcomes = [], prep = []) =>
        set((s) => {
            const panes = new Map(s.panes);
            panes.set(paneId, {
                ...EMPTY_PANE,
                messagesByTab: new Map(messages),
                tokensByTab: new Map(tokens),
                outcomesByTab: new Map(outcomes.map(([tabId, blocks]) => [tabId, new Map(blocks)])),
                prepByTab: new Map(prep.map(([tabId, devices, selfOpened]) => [tabId, { devices: new Map(devices), selfOpened: new Set(selfOpened) }])),
            });
            return { panes };
        }),

    exportPane: (paneId) => {
        const pane = get().panes.get(paneId) ?? EMPTY_PANE;
        return {
            messages: Array.from(pane.messagesByTab.entries()),
            tokens: Array.from(pane.tokensByTab.entries()),
            outcomes: Array.from(pane.outcomesByTab, ([tabId, blocks]) => [tabId, Array.from(blocks.entries())]),
            prep: Array.from(pane.prepByTab, ([tabId, p]) => [tabId, Array.from(p.devices.entries()), Array.from(p.selfOpened)]),
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

/** One tab's prep record right now. */
export function tabPrep(paneId: string, tabId: string): TabPrep {
    return paneTranscripts(paneId).prepByTab.get(tabId) ?? EMPTY_PREP;
}

/** Replace one tab's prep record. */
export function setTabPrep(paneId: string, tabId: string, prep: TabPrep): void {
    useAiTranscriptStore.getState().updatePane(paneId, (p) => {
        const prepByTab = new Map(p.prepByTab);
        prepByTab.set(tabId, prep);
        return { ...p, prepByTab };
    });
}

/** Forget the prep record of the tabs `keep` rejects (all of them when omitted). */
export function forgetPrep(paneId: string, keep: (tabId: string) => boolean = () => false): void {
    useAiTranscriptStore.getState().updatePane(paneId, (p) => {
        if (![...p.prepByTab.keys()].some((id) => !keep(id))) return p;
        return { ...p, prepByTab: new Map([...p.prepByTab].filter(([id]) => keep(id))) };
    });
}
