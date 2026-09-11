/**
 * IP addresses and CIDR prefixes: parse, canonicalise, and test containment.
 *
 * Pure, dependency-free, and deliberately strict. Everything here exists to
 * answer one question — "does this host's address fall inside this NetBox
 * prefix?" — and the answer decides which folder a host lands in, so a
 * generous parser is worse than none: silently reading `192.168.01.1` as
 * octal, or matching an IPv4 host against an IPv6 prefix, puts a host in the
 * wrong site and nothing ever says so.
 *
 * Two design choices carry weight:
 *
 *  1. **Addresses are fixed-length byte arrays, 4 or 16.** A prefix match is
 *     "compare the first N bits", which is the same code for both families
 *     over `Uint8Array`. BigInt would need the family's bit width threaded
 *     through every shift.
 *
 *  2. **IPv4 is never widened to 16 bytes.** Mapping `10.0.0.0/8` to
 *     `::ffff:a00:0/104` would let a genuine IPv6 `/104` claim IPv4 hosts.
 *     `prefixContains` returns false across families, always.
 */

export type IpFamily = 4 | 6;

export interface IpAddress {
    family: IpFamily;
    /** 4 bytes for IPv4, 16 for IPv6. */
    bytes: Uint8Array;
}

export interface IpPrefix {
    family: IpFamily;
    /** The network address: every bit below `bits` is already zero. */
    bytes: Uint8Array;
    bits: number;
}

const V4_BYTES = 4;
const V6_BYTES = 16;
const V6_GROUPS = 8;

// ── parsing ────────────────────────────────────────────────────────────────

/**
 * One IPv4 octet, strictly.
 *
 * A leading zero is refused rather than accepted: `inet_aton` and several JS
 * libraries read `010` as octal 8, so `192.168.010.1` means two different
 * hosts depending on who parses it. There is no reading that is safe to guess.
 */
function parseOctet(text: string): number | null {
    if (text.length === 0 || text.length > 3) return null;
    if (text.length > 1 && text[0] === '0') return null;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c < 48 || c > 57) return null;
    }
    const n = Number(text);
    return n <= 255 ? n : null;
}

function parseIpv4Into(text: string, out: Uint8Array, offset: number): boolean {
    const parts = text.split('.');
    if (parts.length !== V4_BYTES) return false;
    for (let i = 0; i < V4_BYTES; i++) {
        const b = parseOctet(parts[i]);
        if (b === null) return false;
        out[offset + i] = b;
    }
    return true;
}

/** One IPv6 group: 1–4 hex digits. Five digits is a typo, not a big number. */
function parseGroup(text: string): number | null {
    if (text.length === 0 || text.length > 4) return null;
    const lower = text.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
        const c = lower.charCodeAt(i);
        const isDigit = c >= 48 && c <= 57;
        const isHex = c >= 97 && c <= 102;
        if (!isDigit && !isHex) return null;
    }
    return parseInt(lower, 16);
}

/**
 * `::ffff:192.0.2.1` is an IPv4 address written in IPv6 notation, not a
 * separate thing — folding it keeps a host typed that way from silently
 * failing to match its own site's prefix.
 *
 * The deprecated v4-compatible form (`::192.0.2.1`, prefix of 96 zero bits)
 * and NAT64's `64:ff9b::/96` are left as IPv6: those are genuine IPv6
 * addresses that happen to embed v4 digits, and NetBox files them as IPv6.
 */
function foldV4Mapped(bytes: Uint8Array): IpAddress {
    let mapped = true;
    for (let i = 0; i < 10; i++) {
        if (bytes[i] !== 0) { mapped = false; break; }
    }
    if (mapped && bytes[10] === 0xff && bytes[11] === 0xff) {
        return { family: 4, bytes: bytes.slice(12, 16) };
    }
    return { family: 6, bytes };
}

function parseIpv6(text: string): IpAddress | null {
    // A zone (`fe80::1%eth0`) identifies an interface, not an address, and no
    // NetBox prefix carries one. Refuse rather than strip: stripping would
    // match two different link-local hosts against the same prefix.
    if (text.includes('%')) return null;

    const doubleColon = text.indexOf('::');
    if (doubleColon !== text.lastIndexOf('::')) return null;

    const bytes = new Uint8Array(V6_BYTES);
    let head: string[];
    let tail: string[];
    if (doubleColon === -1) {
        head = text.split(':');
        tail = [];
    } else {
        const before = text.slice(0, doubleColon);
        const after = text.slice(doubleColon + 2);
        head = before === '' ? [] : before.split(':');
        tail = after === '' ? [] : after.split(':');
    }
    if (head.some(g => g === '') || tail.some(g => g === '')) return null;

    // A trailing dotted quad occupies the last two groups.
    let groupsUsed = 0;
    const last = tail.length > 0 ? tail[tail.length - 1] : head[head.length - 1];
    if (last !== undefined && last.includes('.')) {
        const v4 = new Uint8Array(V4_BYTES);
        if (!parseIpv4Into(last, v4, 0)) return null;
        // Placed after the variable-length gap is resolved; hold it for now.
        if (tail.length > 0) tail = tail.slice(0, -1);
        else head = head.slice(0, -1);
        bytes[12] = v4[0];
        bytes[13] = v4[1];
        bytes[14] = v4[2];
        bytes[15] = v4[3];
        groupsUsed = 2;
    }

    const total = head.length + tail.length + groupsUsed;
    if (doubleColon === -1) {
        // No gap: the address must be exactly full.
        if (total !== V6_GROUPS) return null;
    } else {
        // `::` must stand for at least one group; otherwise it is a full
        // address written with a pointless gap, which is not valid IPv6.
        if (total >= V6_GROUPS) return null;
    }

    for (let i = 0; i < head.length; i++) {
        const g = parseGroup(head[i]);
        if (g === null) return null;
        bytes[i * 2] = g >> 8;
        bytes[i * 2 + 1] = g & 0xff;
    }
    // The tail sits flush against the end, before any embedded v4 quad.
    const tailEndGroup = V6_GROUPS - groupsUsed;
    for (let i = 0; i < tail.length; i++) {
        const g = parseGroup(tail[i]);
        if (g === null) return null;
        const groupIndex = tailEndGroup - tail.length + i;
        bytes[groupIndex * 2] = g >> 8;
        bytes[groupIndex * 2 + 1] = g & 0xff;
    }
    return foldV4Mapped(bytes);
}

/**
 * Read one IP literal. `null` for anything else — a hostname, a `user@host`,
 * a `host:port`, an empty string.
 *
 * Nothing here resolves names. A DNS lookup would turn "which folder does this
 * go in?" into a network call whose answer changes between two runs.
 */
export function parseIpAddress(text: string): IpAddress | null {
    const t = text.trim();
    if (t.length === 0) return null;
    if (t.includes(':')) return parseIpv6(t);
    const bytes = new Uint8Array(V4_BYTES);
    return parseIpv4Into(t, bytes, 0) ? { family: 4, bytes } : null;
}

/** Zero every bit at or below `bits`, in place. */
function maskInPlace(bytes: Uint8Array, bits: number): void {
    for (let i = 0; i < bytes.length; i++) {
        const keep = bits - i * 8;
        if (keep >= 8) continue;
        bytes[i] = keep <= 0 ? 0 : bytes[i] & (0xff << (8 - keep)) & 0xff;
    }
}

/**
 * Read one CIDR prefix, e.g. `10.1.0.0/16`.
 *
 * Host bits are masked off rather than refused: NetBox accepts
 * `192.168.1.5/24` and stores it that way, and refusing would drop a prefix
 * the user can see in their own NetBox. The canonical network form is what
 * gets stored, so two spellings of one network compare equal.
 *
 * A bare address with no mask is refused. NetBox always writes the mask, and
 * guessing `/32` would turn a typo into a prefix that matches exactly one host
 * and looks like it works.
 */
export function parseCidr(text: string): IpPrefix | null {
    const t = text.trim();
    const slash = t.indexOf('/');
    if (slash === -1) return null;
    if (t.indexOf('/', slash + 1) !== -1) return null;

    const addrText = t.slice(0, slash);
    const addr = parseIpAddress(addrText);
    if (addr === null) return null;

    // `::ffff:10.0.0.0/104` is a real notation, but its mask counts IPv6 bits
    // while the folded address counts IPv4 ones — the two readings differ and
    // there is no way to tell which was meant. NetBox writes IPv4 prefixes in
    // IPv4 notation, so refusing costs nothing and guessing could not be
    // checked by anything.
    if (addr.family === 4 && addrText.includes(':')) return null;

    const maskText = t.slice(slash + 1);
    if (maskText.length === 0 || maskText.length > 3) return null;
    if (maskText.length > 1 && maskText[0] === '0') return null;
    for (let i = 0; i < maskText.length; i++) {
        const c = maskText.charCodeAt(i);
        if (c < 48 || c > 57) return null;
    }
    const bits = Number(maskText);
    if (bits > addr.bytes.length * 8) return null;

    const bytes = addr.bytes.slice();
    maskInPlace(bytes, bits);
    return { family: addr.family, bytes, bits };
}

// ── formatting ─────────────────────────────────────────────────────────────

/**
 * RFC 5952 canonical text: lowercase hex, no leading zeros, the leftmost
 * longest run of zero groups compressed to `::`, and a single zero group never
 * compressed.
 *
 * This is load-bearing, not cosmetic. The stored strings are compared to
 * decide whether a sync changed anything; if one network could be written two
 * ways, every sync would look like a change and re-encrypt the whole host tree,
 * write it to localStorage and broadcast it to every window.
 */
function formatIpv6(bytes: Uint8Array): string {
    const groups: number[] = [];
    for (let i = 0; i < V6_GROUPS; i++) groups.push((bytes[i * 2] << 8) | bytes[i * 2 + 1]);

    let bestStart = -1;
    let bestLen = 0;
    let runStart = -1;
    for (let i = 0; i <= V6_GROUPS; i++) {
        const isZero = i < V6_GROUPS && groups[i] === 0;
        if (isZero && runStart === -1) runStart = i;
        if (!isZero && runStart !== -1) {
            const len = i - runStart;
            // Strictly greater keeps the LEFTMOST longest run, as RFC 5952 requires.
            if (len > bestLen) { bestLen = len; bestStart = runStart; }
            runStart = -1;
        }
    }
    // A single zero group is written `0`, never `::`.
    if (bestLen < 2) {
        return groups.map(g => g.toString(16)).join(':');
    }
    const head = groups.slice(0, bestStart).map(g => g.toString(16)).join(':');
    const tail = groups.slice(bestStart + bestLen).map(g => g.toString(16)).join(':');
    return `${head}::${tail}`;
}

export function formatAddress(a: IpAddress): string {
    if (a.family === 4) return Array.from(a.bytes).join('.');
    return formatIpv6(a.bytes);
}

export function formatPrefix(p: IpPrefix): string {
    return `${formatAddress({ family: p.family, bytes: p.bytes })}/${p.bits}`;
}

// ── matching ───────────────────────────────────────────────────────────────

/**
 * Whether `a` falls inside `p`.
 *
 * Families never mix. An IPv4 host is not "inside" an IPv6 prefix under any
 * reading, and returning true for one would file it in a folder chosen by
 * coincidence.
 */
export function prefixContains(p: IpPrefix, a: IpAddress): boolean {
    if (p.family !== a.family) return false;
    const whole = p.bits >> 3;
    for (let i = 0; i < whole; i++) {
        if (p.bytes[i] !== a.bytes[i]) return false;
    }
    const rest = p.bits & 7;
    if (rest === 0) return true;
    const mask = (0xff << (8 - rest)) & 0xff;
    return (p.bytes[whole] & mask) === (a.bytes[whole] & mask);
}

/** A total order, so the same set of prefixes always stores in the same order. */
export function comparePrefixes(a: IpPrefix, b: IpPrefix): number {
    if (a.family !== b.family) return a.family - b.family;
    for (let i = 0; i < a.bytes.length; i++) {
        if (a.bytes[i] !== b.bytes[i]) return a.bytes[i] - b.bytes[i];
    }
    return a.bits - b.bits;
}
