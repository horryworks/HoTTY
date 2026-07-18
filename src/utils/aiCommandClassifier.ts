/**
 * Auto-execution decision orchestrator.
 *
 * Per command, in auto-execute-safe mode, decides between auto-execute and
 * "ask before execute", and records WHY for the UI. The model (Hybrid, default):
 *
 *   1. Blacklist match (user list)  → ask before execute. Checked first (safety).
 *   2. Structural danger (floor)    → ask. Redirection/substitution/chaining/
 *                                      sudo NEVER auto-run, whatever a verdict
 *                                      says — applied to every strategy so the AI
 *                                      path can't approve what the whitelist path
 *                                      rejects structurally.
 *   3. Whitelist match (user list)  → auto-execute.
 *   4. AI verdict                   → read-only & confident → auto; else → ask.
 *   5. None of the above            → ask before execute.
 *
 * Strategy variants: `static` skips step 4; `ai` skips step 3; `hybrid` (default)
 * runs all. Anything that can't be decided (AI error/timeout/unauthed) falls back
 * to manual — never to "assume safe".
 *
 * AI verdicts are cached per (provider, model, normalized command).
 */

import type { ClassifierStrategy, CommandVerdict } from '../types/appTypes';
import { matchBlacklist } from './commandLists';
import { classifyCommand, structuralDanger } from './commandClassifier';
import { tauriService } from '../services/tauriService';

type DecisionSource = 'blacklist' | 'whitelist' | 'ai' | 'ask' | 'fallback';

export interface AutoExecDecision {
    /** Whether the command may be auto-executed. */
    autoExec: boolean;
    /** Human-readable justification, shown in the UI. */
    reason: string;
    /** Which layer produced the decision. */
    source: DecisionSource;
    /** AI self-reported confidence (only for `source === 'ai'`). */
    confidence?: number;
}

export interface DecideOptions {
    strategy: ClassifierStrategy;
    /** Model used for AI classification (typically the active chat model). */
    model: string;
    /** Active provider id, part of the cache key. */
    providerId: string;
    /** User-managed whitelist entries (auto-execute). */
    whitelist: string[];
    /** User-managed blacklist entries (ask before execute). */
    blacklist: string[];
    /** Minimum AI confidence to auto-execute a read-only verdict. */
    confidenceThreshold: number;
}

// ── Verdict cache (module-level, survives component remounts) ─────────────────

const CACHE_LIMIT = 200;
const verdictCache = new Map<string, CommandVerdict>();

function normalize(command: string): string {
    return command.trim().replace(/\s+/g, ' ');
}

function cacheKey(opts: DecideOptions, command: string): string {
    return `${opts.providerId} ${opts.model} ${normalize(command)}`;
}

function cacheGet(key: string): CommandVerdict | undefined {
    const v = verdictCache.get(key);
    if (v) {
        verdictCache.delete(key);
        verdictCache.set(key, v);
    }
    return v;
}

function cacheSet(key: string, verdict: CommandVerdict): void {
    verdictCache.set(key, verdict);
    while (verdictCache.size > CACHE_LIMIT) {
        const oldest = verdictCache.keys().next().value;
        if (oldest === undefined) break;
        verdictCache.delete(oldest);
    }
}

/** Test-only: clear the verdict cache. */
export function _clearVerdictCache(): void {
    verdictCache.clear();
}

// ── AI step (shared by hybrid / ai strategies) ───────────────────────────────

async function aiDecision(command: string, opts: DecideOptions): Promise<AutoExecDecision> {
    const key = cacheKey(opts, command);
    let verdict = cacheGet(key);
    if (!verdict) {
        try {
            verdict = await tauriService.aiClassifyCommand(command, opts.model);
            cacheSet(key, verdict);
        } catch (e) {
            const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : 'classification failed';
            return { autoExec: false, reason: msg, source: 'fallback' };
        }
    }
    const autoExec = !verdict.modifiesState && verdict.confidence >= opts.confidenceThreshold;
    return { autoExec, reason: verdict.reason, source: 'ai', confidence: verdict.confidence };
}

// ── Decision ─────────────────────────────────────────────────────────────────

export async function decideAutoExec(
    command: string,
    opts: DecideOptions,
): Promise<AutoExecDecision> {
    // 1. Blacklist — always checked first; a match never auto-runs.
    const blk = matchBlacklist(command, opts.blacklist);
    if (blk.matched) {
        return {
            autoExec: false,
            reason: blk.entry ? `matches blacklist entry "${blk.entry}"` : 'blacklisted',
            source: 'blacklist',
        };
    }

    // 2. Structural-danger floor — applies to EVERY strategy, before the AI path.
    // A redirection / command-substitution / chaining / sudo construct must never
    // auto-execute even if the AI rates the command read-only and confident. The
    // whitelist path already enforces this; hoisting it here closes the gap where
    // the `ai`/`hybrid` AI verdict could otherwise approve it.
    const danger = structuralDanger(command);
    if (danger.danger) {
        return { autoExec: false, reason: danger.reason, source: 'ask' };
    }

    if (opts.strategy === 'ai') {
        // Skip the whitelist fast-path; let the AI judge everything else.
        return aiDecision(command, opts);
    }

    // 2. Whitelist (static + hybrid).
    const c = classifyCommand(command, opts.whitelist);
    if (c.safe) {
        return { autoExec: true, reason: c.reason || 'whitelisted', source: 'whitelist' };
    }

    // 3. AI judgment (hybrid only).
    if (opts.strategy === 'hybrid') {
        return aiDecision(command, opts);
    }

    // 4. static strategy, not whitelisted → ask.
    return { autoExec: false, reason: c.reason, source: 'ask' };
}
