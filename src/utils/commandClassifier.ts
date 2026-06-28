/**
 * Command safety classifier for AI auto-execution (Whitelist layer).
 *
 * Determines whether a command is "whitelist-safe" — i.e. safe to auto-execute:
 *   1. Reject commands with dangerous shell patterns (redirections, substitutions, chaining, sudo)
 *   2. Split by pipe and evaluate each segment independently
 *   3. Each segment must be covered by the (caller-supplied) whitelist —
 *      a base-command token match, or a multi-token phrase substring match
 *   4. Check for dangerous flags on whitelisted base commands
 *
 * The whitelist is injected by the caller (managed in Settings; defaults live in
 * `commandLists.ts` as DEFAULT_WHITELIST). When in doubt, classify as unsafe.
 */

interface CommandClassification {
    safe: boolean;
    reason: string;
}

// ── Danger patterns (applied before pipe splitting) ─────────────────────────

const DANGER_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /(?:^|[^|])>/, reason: 'Contains output redirection' },
    { pattern: />>/, reason: 'Contains append redirection' },
    { pattern: /(?:^|[^0-9])<(?![<=])/, reason: 'Contains input redirection' },
    { pattern: /\$\(/, reason: 'Contains command substitution $()' },
    { pattern: /`[^`]*`/, reason: 'Contains command substitution (backticks)' },
    { pattern: /(?:^|[^|]);/, reason: 'Contains command chaining (;)' },
    { pattern: /&&/, reason: 'Contains command chaining (&&)' },
    { pattern: /\|\|/, reason: 'Contains command chaining (||)' },
    { pattern: /(?:^|\s)sudo(?:\s|$)/, reason: 'Contains privilege escalation (sudo)' },
    { pattern: /(?:^|\s)su(?:\s|$)/, reason: 'Contains privilege escalation (su)' },
    { pattern: /(?:^|\s)doas(?:\s|$)/, reason: 'Contains privilege escalation (doas)' },
];

// ── Dangerous flag rules per command ────────────────────────────────────────

interface FlagRule {
    patterns: RegExp[];
    reason: string;
}

const DANGEROUS_FLAGS: Record<string, FlagRule[]> = {
    find: [
        { patterns: [/-delete\b/], reason: 'find with -delete' },
        { patterns: [/-exec\b/], reason: 'find with -exec' },
    ],
    curl: [
        { patterns: [/-X\s*(POST|PUT|DELETE|PATCH)\b/i], reason: 'curl with write method' },
        { patterns: [/(?:^|\s)(?:-d|--data|--data-\w+)\b/], reason: 'curl with data payload' },
        { patterns: [/(?:^|\s)(?:--upload-file|-T)\b/], reason: 'curl with file upload' },
    ],
    wget: [
        { patterns: [/--post-data\b/, /--post-file\b/], reason: 'wget with POST data' },
    ],
    sed: [
        { patterns: [/(?:^|\s)-i\b/], reason: 'sed with in-place edit (-i)' },
    ],
    git: [
        { patterns: [/\b(?:push|reset|checkout|merge|rebase|rm|clean|stash)\b/], reason: 'git write operation' },
    ],
    apt: [
        { patterns: [/\b(?:install|remove|upgrade|update|purge|autoremove)\b/], reason: 'apt package modification' },
    ],
    dpkg: [
        { patterns: [/(?:^|\s)(?:-i|--install|-r|--remove|-P|--purge)\b/], reason: 'dpkg package modification' },
    ],
    rpm: [
        { patterns: [/(?:^|\s)(?:-i|--install|-e|--erase|-U|--upgrade)\b/], reason: 'rpm package modification' },
    ],
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Classify a command as safe (auto-executable) or not, against a whitelist.
 *
 * @param command   Raw command string from AI
 * @param whitelist Caller-supplied whitelist entries (base-command tokens and/or
 *                  multi-token phrases). Defaults live in `commandLists.ts`.
 * @returns         Classification result with reason
 */
export function classifyCommand(
    command: string,
    whitelist: string[] = [],
): CommandClassification {
    const trimmed = command.trim();

    // Step 1: empty check
    if (!trimmed) {
        return { safe: false, reason: 'Empty command' };
    }

    // Split the whitelist into base-command tokens (no whitespace) and phrases.
    const tokenSet = new Set<string>();
    const phrases: string[] = [];
    for (const raw of whitelist) {
        const e = raw.trim().toLowerCase();
        if (!e) continue;
        if (/\s/.test(e)) phrases.push(e);
        else tokenSet.add(e);
    }

    // Step 1.5: multi-line handling — classify each line independently
    const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length > 1) {
        for (const line of lines) {
            const result = classifyCommand(line, whitelist);
            if (!result.safe) {
                return result;
            }
        }
        return { safe: true, reason: 'All commands are whitelisted' };
    }

    // Step 2: danger patterns (before pipe splitting) — structural integrity floor
    for (const { pattern, reason } of DANGER_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { safe: false, reason };
        }
    }

    // Step 3: split by pipe and evaluate each segment
    const segments = trimmed.split('|').map(s => s.trim()).filter(Boolean);

    for (const segment of segments) {
        const result = classifySegment(segment, tokenSet, phrases);
        if (!result.safe) {
            return result;
        }
    }

    return { safe: true, reason: 'All commands are whitelisted' };
}

// ── Internal helpers ────────────────────────────────────────────────────────

function classifySegment(
    segment: string,
    tokenSet: Set<string>,
    phrases: string[],
): CommandClassification {
    const baseCommand = extractBaseCommand(segment);
    if (!baseCommand) {
        return { safe: false, reason: 'Cannot parse command' };
    }

    const baseLower = baseCommand.toLowerCase();
    const segLower = segment.toLowerCase();

    // Whitelisted if the base command is a whitelist token …
    if (tokenSet.has(baseLower)) {
        const flagRules = DANGEROUS_FLAGS[baseLower];
        if (flagRules) {
            for (const rule of flagRules) {
                for (const pat of rule.patterns) {
                    if (pat.test(segment)) {
                        return { safe: false, reason: rule.reason };
                    }
                }
            }
        }
        return { safe: true, reason: '' };
    }

    // … or a whitelist phrase matches the segment as an anchored prefix (the
    // phrase must START the segment, on a word boundary). Anchoring prevents a
    // benign whitelisted phrase from auto-allowing any command that merely
    // CONTAINS it as a substring (e.g. `… # git log` smuggling past a `git log`
    // entry) — an auto-exec escalation vector.
    if (phrases.some((p) => segLower === p || segLower.startsWith(`${p} `))) {
        return { safe: true, reason: '' };
    }

    return { safe: false, reason: `Unknown command: ${baseCommand}` };
}

export function extractBaseCommand(segment: string): string | null {
    const trimmed = segment.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^(\S+)/);
    return match ? match[1] : null;
}
