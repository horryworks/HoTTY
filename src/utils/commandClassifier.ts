/**
 * Command safety classifier for AI auto-execution.
 *
 * Uses a whitelist + danger-pattern approach:
 *   1. Reject commands with dangerous shell patterns (redirections, substitutions, chaining, sudo)
 *   2. Split by pipe and evaluate each segment independently
 *   3. Check each segment's base command against the whitelist
 *   4. Check for dangerous flags on whitelisted commands
 *
 * When in doubt, classify as unsafe (manual confirmation fallback).
 */

interface CommandClassification {
    safe: boolean;
    reason: string;
}

// ── Built-in safe commands whitelist ─────────────────────────────────────────

const BUILTIN_SAFE_COMMANDS = new Set([
    // File / directory inspection (read-only)
    'ls', 'dir', 'll', 'la',
    'cat', 'head', 'tail', 'less', 'more',
    'file', 'stat', 'wc', 'md5sum', 'sha256sum',
    'find', 'locate', 'which', 'whereis', 'type', 'tree',

    // Text search / processing (redirections are blocked separately)
    'grep', 'egrep', 'fgrep', 'rg',
    'awk', 'sed',
    'sort', 'uniq', 'cut', 'tr', 'diff', 'comm', 'strings',

    // System information
    'uname', 'hostname', 'whoami', 'id', 'groups',
    'date', 'uptime', 'w', 'who', 'last',
    'df', 'du', 'free', 'vmstat', 'iostat', 'mpstat',
    'top', 'htop', 'ps', 'pgrep',
    'lsblk', 'lscpu', 'lspci', 'lsusb', 'lsmod', 'dmesg',
    'printenv', 'env', 'echo', 'printf', 'sysctl',

    // Network diagnostics
    'ping', 'ping6', 'traceroute', 'tracert', 'tracepath', 'mtr',
    'dig', 'nslookup', 'host', 'whois',
    'ip', 'ifconfig', 'route',
    'netstat', 'ss', 'arp',
    'curl', 'wget', 'nmap',

    // Version control (dangerous subcommands blocked in flag check)
    'git',

    // Path / misc
    'pwd', 'realpath', 'basename', 'dirname',
    'man', 'help', 'info', 'history', 'test',

    // Windows
    'get-process', 'get-service', 'get-content', 'get-childitem',
    'get-netadapter', 'get-netipaddress', 'get-netroute',
    'ipconfig', 'systeminfo', 'tasklist', 'netsh', 'ver', 'set',

    // ── Network device CLI ──

    // Cisco IOS / IOS-XE / NX-OS
    'show',
    // Huawei VRP
    'display',
    // Palo Alto / FortiGate
    'get', 'diagnose',
    // Vendor-common read-only
    'terminal',

    // ── Pipe filter keywords (network device CLI) ──
    // Cisco:  | include / exclude / begin / section / count
    // Huawei: | include / exclude / begin / count
    // Juniper: | match / except / find / count / no-more
    // NOTE: redirect / append / tee are intentionally excluded (file-write)
    'include', 'exclude', 'begin', 'section',
    'match', 'except', 'find-regexp',
    'no-more', 'count', 'last', 'utility',
]);

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
 * Classify a command as safe or unsafe for auto-execution.
 *
 * @param command       Raw command string from AI
 * @param customSafe    User-defined additional safe commands (lowercase)
 * @returns             Classification result with reason
 */
export function classifyCommand(
    command: string,
    customSafe: string[] = [],
): CommandClassification {
    const trimmed = command.trim();

    // Step 1: empty check
    if (!trimmed) {
        return { safe: false, reason: 'Empty command' };
    }

    // Step 1.5: multi-line handling — classify each line independently
    const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length > 1) {
        for (const line of lines) {
            const result = classifyCommand(line, customSafe);
            if (!result.safe) {
                return result;
            }
        }
        return { safe: true, reason: 'All commands are in the safe list' };
    }

    // Step 2: danger patterns (before pipe splitting)
    for (const { pattern, reason } of DANGER_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { safe: false, reason };
        }
    }

    // Build effective whitelist (built-in + custom)
    const whitelist = new Set(BUILTIN_SAFE_COMMANDS);
    for (const cmd of customSafe) {
        whitelist.add(cmd.toLowerCase());
    }

    // Step 3: split by pipe and evaluate each segment
    const segments = trimmed.split('|').map(s => s.trim()).filter(Boolean);

    for (const segment of segments) {
        const result = classifySegment(segment, whitelist);
        if (!result.safe) {
            return result;
        }
    }

    return { safe: true, reason: 'All commands are in the safe list' };
}

// ── Internal helpers ────────────────────────────────────────────────────────

function classifySegment(
    segment: string,
    whitelist: Set<string>,
): CommandClassification {
    // Step 4: extract base command (first token)
    const baseCommand = extractBaseCommand(segment);
    if (!baseCommand) {
        return { safe: false, reason: 'Cannot parse command' };
    }

    const baseLower = baseCommand.toLowerCase();

    // Step 5: whitelist check
    if (!whitelist.has(baseLower)) {
        return { safe: false, reason: `Unknown command: ${baseCommand}` };
    }

    // Step 6: dangerous flag check
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

function extractBaseCommand(segment: string): string | null {
    const trimmed = segment.trim();
    if (!trimmed) return null;

    // Handle quoted strings at the start (unlikely but defensive)
    const match = trimmed.match(/^(\S+)/);
    return match ? match[1] : null;
}
