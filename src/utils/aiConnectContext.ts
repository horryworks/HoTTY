import { buildAliasEntries, type AliasEntry } from './terminalAlias';
import { lookupSession, toWatchedTerminalInfo, type SessionSources } from './sessionLookup';
import { summarizeAiOpened, type WatchedTerminalView } from './aiConnectRequest';
import type { ConnectCapabilityInput } from '../constants/aiPrompts';
import type { AiConnectPolicy, AiLocalShellType } from '../types/appTypes';

/**
 * Glue between a chat tab's watched-terminal list and the pure connect helpers.
 * Every place that needs to reason about "what this tab watches" for the AI
 * connect feature — the send-time prompt block (useAiChat + the pane's send
 * loop), the gate (AIChatPane), and the orchestrator's alias lookup — builds the
 * SAME views here, so the aliases the model reads, the aliases the resolver
 * matches, and the aliases the envelopes echo can never disagree.
 */

export interface WatchedLink {
    sessionId: string;
    aiOpened?: boolean;
}

export interface WatchedViews {
    aliases: AliasEntry[];
    views: WatchedTerminalView[];
}

export function buildWatchedViews(linked: readonly WatchedLink[], src: SessionSources): WatchedViews {
    const looked = linked.map((w) => ({ link: w, view: lookupSession(w.sessionId, src) }));
    const aliases = buildAliasEntries(looked.map(({ link, view }) => ({
        sessionId: link.sessionId,
        displayName: view?.displayName ?? link.sessionId,
        status: view?.status,
    })));
    const views: WatchedTerminalView[] = looked.map(({ link, view }, i) => ({
        sessionId: link.sessionId,
        alias: aliases[i].alias,
        displayName: aliases[i].displayName,
        aiOpened: !!link.aiOpened,
        info: toWatchedTerminalInfo(view),
    }));
    return { aliases, views };
}

export interface ConnectCapabilitySettings {
    policy: AiConnectPolicy;
    localShellType: AiLocalShellType;
    maxOpened: number;
    idleMinutes: number;
}

/** Everything `buildConnectCapabilityBlock` needs, derived from the tab's watched set. */
export function buildConnectCapabilityInput(
    linked: readonly WatchedLink[],
    src: SessionSources,
    settings: ConnectCapabilitySettings,
): ConnectCapabilityInput {
    const { views } = buildWatchedViews(linked, src);
    const summary = summarizeAiOpened(views);
    return {
        policy: settings.policy,
        localShellType: settings.localShellType,
        terminals: views.map((v) => ({
            alias: v.alias,
            displayName: v.displayName,
            live: v.info?.status === 'connected',
            host: v.info?.host,
            protocol: v.info?.protocol || undefined,
            aiOpened: v.aiOpened,
        })),
        localShellOpen: summary.local?.alias,
        remainingSlots: Math.max(0, settings.maxOpened - summary.liveCount),
        idleMinutes: settings.idleMinutes,
    };
}
