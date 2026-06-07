/**
 * User-managed Whitelist / Blacklist matching for AI auto-execution.
 *
 * Both lists are fully managed in Settings (seeded with the defaults below).
 * Matching follows the "command name + substring" rule:
 *   - A single-token entry (no whitespace) matches as a BASE COMMAND on any pipe
 *     segment of a line, e.g. `docker` matches `docker rm -f x` and `a | docker ps`.
 *   - A multi-token entry (contains whitespace) matches as a case-insensitive
 *     SUBSTRING of the line, e.g. `rm -rf`, `git push`, `> /etc`.
 *
 * The Whitelist drives auto-execution (via `classifyCommand`, which also keeps
 * the structural-danger checks); the Blacklist drives "ask before execute".
 */

import { extractBaseCommand } from './commandClassifier';

export interface ListMatch {
    matched: boolean;
    entry?: string;
}

/** Does a single list `entry` match a single command `line`? */
export function entryMatches(line: string, entry: string): boolean {
    const e = entry.trim().toLowerCase();
    if (!e) return false;
    const l = line.trim().toLowerCase();
    if (!l) return false;

    if (/\s/.test(e)) {
        // Phrase → substring match.
        return l.includes(e);
    }
    // Single token → base-command match on any pipe segment. Also matches a
    // dotted command family (e.g. `mkfs` matches `mkfs.ext4` / `mkfs.xfs`).
    return l.split('|').some((seg) => {
        const base = extractBaseCommand(seg)?.toLowerCase();
        if (!base) return false;
        return base === e || base.startsWith(`${e}.`);
    });
}

/**
 * Blacklist match: true if ANY line of the (possibly multi-line) command matches
 * ANY entry. Returns the offending entry for display.
 */
export function matchBlacklist(command: string, entries: string[]): ListMatch {
    const lines = command
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    for (const line of lines) {
        for (const entry of entries) {
            if (entryMatches(line, entry)) {
                return { matched: true, entry };
            }
        }
    }
    return { matched: false };
}

// ── Default Whitelist (seeded into Settings; user-editable) ───────────────────
// Read-only / safe base commands. Previously hardcoded as BUILTIN_SAFE_COMMANDS.

export const DEFAULT_WHITELIST: string[] = [
    // File / directory inspection (read-only)
    'ls', 'dir', 'll', 'la',
    'cat', 'head', 'tail', 'less', 'more',
    'file', 'stat', 'wc', 'md5sum', 'sha256sum',
    'find', 'locate', 'which', 'whereis', 'type', 'tree',

    // Text search / processing (redirections are blocked structurally)
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

    // Version control (dangerous subcommands blocked structurally / via blacklist)
    'git',

    // Path / misc
    'pwd', 'realpath', 'basename', 'dirname',
    'man', 'help', 'info', 'history', 'test',

    // Windows
    'get-process', 'get-service', 'get-content', 'get-childitem',
    'get-netadapter', 'get-netipaddress', 'get-netroute',
    'ipconfig', 'systeminfo', 'tasklist', 'netsh', 'ver', 'set',

    // Network device CLI
    'show', 'display', 'get', 'diagnose', 'terminal', 'screen-length',

    // Pipe filter keywords (network device CLI)
    'include', 'exclude', 'begin', 'section',
    'match', 'except', 'find-regexp',
    'no-more', 'count',
];

// ── Default Blacklist (seeded into Settings; user-editable) ───────────────────
// Destructive / state-changing commands and phrases. A match → "ask before
// execute" (manual Run still allowed). Derived from the old catastrophic deny
// guard plus common write operations.

export const DEFAULT_BLACKLIST: string[] = [
    // Privilege escalation
    'sudo', 'doas', 'su', 'runas',
    'start-process -verb runas',

    // Recursive / forced filesystem destruction
    'rm -rf', 'rm -fr', 'rm -r', 'rmdir /s', 'del /s', 'del /f',
    'remove-item -recurse', 'remove-item -force',
    'shred', 'wipe',

    // Disk / partition / format
    'mkfs', 'dd', 'fdisk', 'parted', 'gparted', 'sfdisk', 'diskpart', 'format',
    '> /dev/sd',

    // Power / system state
    'shutdown', 'reboot', 'halt', 'poweroff', 'init 0', 'init 6',
    'stop-computer', 'restart-computer',

    // Pipe remote content into a shell / arbitrary eval
    ':(){', '| sh', '| bash', '| zsh', '| iex', 'invoke-expression', 'iex', 'eval',

    // Writes to system / device paths & registry
    '> /etc', '> /dev', '> /sys', '> /boot', '> /usr', '> /var',
    '> c:\\windows', 'reg add', 'reg delete', 'set-itemproperty hklm',

    // Package management
    'apt install', 'apt remove', 'apt purge', 'apt upgrade',
    'apt-get install', 'apt-get remove',
    'dpkg -i', 'dpkg -r', 'yum install', 'yum remove', 'dnf install',

    // Version control / file writes (write operations)
    'git push', 'git reset', 'git rebase', 'git clean',
    'sed -i',
    'curl -x post', 'curl -x put', 'curl -x delete', 'curl -d', 'curl --data',
    'wget --post-data', 'wget --post-file',

    // Network device config-mode entry
    'configure terminal', 'conf t', 'system-view', 'write memory', 'copy run start',

    // History / credential wipe
    'history -c',
];
