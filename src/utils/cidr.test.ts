import { describe, it, expect } from 'vitest';
import {
    parseIpAddress,
    parseCidr,
    formatAddress,
    formatPrefix,
    prefixContains,
    comparePrefixes,
    type IpPrefix,
} from './cidr';

/** `parseIpAddress` that throws instead of returning null, for the happy path. */
function addr(text: string) {
    const a = parseIpAddress(text);
    if (a === null) throw new Error(`expected ${text} to parse`);
    return a;
}

function cidr(text: string): IpPrefix {
    const p = parseCidr(text);
    if (p === null) throw new Error(`expected ${text} to parse`);
    return p;
}

describe('parseIpAddress', () => {
    it('reads a dotted-quad IPv4', () => {
        expect(Array.from(addr('192.0.2.1').bytes)).toEqual([192, 0, 2, 1]);
        expect(addr('192.0.2.1').family).toBe(4);
    });

    it('refuses an octet with a leading zero, which some parsers read as octal', () => {
        // `192.168.010.1` is host .8 to inet_aton and host .10 to most JS code.
        expect(parseIpAddress('192.168.010.1')).toBeNull();
        expect(parseIpAddress('01.2.3.4')).toBeNull();
    });

    it('accepts a lone zero octet', () => {
        expect(Array.from(addr('0.0.0.0').bytes)).toEqual([0, 0, 0, 0]);
    });

    it('refuses three or five octets and an octet above 255', () => {
        expect(parseIpAddress('192.0.2')).toBeNull();
        expect(parseIpAddress('192.0.2.1.5')).toBeNull();
        expect(parseIpAddress('192.0.2.256')).toBeNull();
        expect(parseIpAddress('192.0.2.-1')).toBeNull();
    });

    it('refuses a bare 32-bit integer', () => {
        expect(parseIpAddress('3221225985')).toBeNull();
    });

    it('reads a full eight-group IPv6', () => {
        const a = addr('2001:0db8:0000:0000:0000:0000:0000:0001');
        expect(a.family).toBe(6);
        expect(formatAddress(a)).toBe('2001:db8::1');
    });

    it('expands :: at the start, in the middle and at the end', () => {
        expect(formatAddress(addr('::1'))).toBe('::1');
        expect(formatAddress(addr('2001:db8::1'))).toBe('2001:db8::1');
        expect(formatAddress(addr('2001:db8::'))).toBe('2001:db8::');
        expect(formatAddress(addr('::'))).toBe('::');
    });

    it('refuses two :: runs', () => {
        expect(parseIpAddress('2001::db8::1')).toBeNull();
    });

    it('refuses :: standing for nothing in an already full address', () => {
        expect(parseIpAddress('1:2:3:4:5:6:7:8::')).toBeNull();
        expect(parseIpAddress('::1:2:3:4:5:6:7:8')).toBeNull();
    });

    it('refuses a group of five hex digits and a stray empty group', () => {
        expect(parseIpAddress('2001:db8:00000::1')).toBeNull();
        expect(parseIpAddress('2001::db8:::1')).toBeNull();
        expect(parseIpAddress(':1:2:3:4:5:6:7')).toBeNull();
    });

    it('reads an IPv6 with a dotted-quad tail', () => {
        const a = addr('2001:db8::192.0.2.1');
        expect(a.family).toBe(6);
        expect(formatAddress(a)).toBe('2001:db8::c000:201');
    });

    it('folds ::ffff:192.0.2.1 down to the IPv4 it is', () => {
        const a = addr('::ffff:192.0.2.1');
        expect(a.family).toBe(4);
        expect(formatAddress(a)).toBe('192.0.2.1');
    });

    it('leaves the deprecated ::192.0.2.1 as IPv6', () => {
        // A v4-compatible address is a genuine IPv6 address, and NetBox files
        // it as one.
        expect(addr('::192.0.2.1').family).toBe(6);
        expect(addr('64:ff9b::1').family).toBe(6);
    });

    it('refuses a zone suffix', () => {
        // A zone names an interface, not an address; stripping it would match
        // two different link-local hosts against one prefix.
        expect(parseIpAddress('fe80::1%eth0')).toBeNull();
    });

    it('refuses a hostname, an empty string and whitespace', () => {
        expect(parseIpAddress('router1.example.com')).toBeNull();
        expect(parseIpAddress('')).toBeNull();
        expect(parseIpAddress('   ')).toBeNull();
        expect(parseIpAddress('alice@192.0.2.1')).toBeNull();
    });

    it('ignores surrounding whitespace', () => {
        expect(formatAddress(addr('  192.0.2.1  '))).toBe('192.0.2.1');
    });
});

describe('parseCidr', () => {
    it('masks the host bits off, so 192.168.1.5/24 settles as 192.168.1.0/24', () => {
        // NetBox accepts and stores host bits; refusing would drop a prefix the
        // user can see in their own NetBox.
        expect(formatPrefix(cidr('192.168.1.5/24'))).toBe('192.168.1.0/24');
    });

    it('masks host bits off an IPv6 prefix too', () => {
        expect(formatPrefix(cidr('2001:db8::1234/64'))).toBe('2001:db8::/64');
    });

    it('masks inside a byte', () => {
        expect(formatPrefix(cidr('10.1.255.7/20'))).toBe('10.1.240.0/20');
    });

    it('refuses a mask above the family width', () => {
        expect(parseCidr('192.0.2.0/33')).toBeNull();
        expect(parseCidr('2001:db8::/129')).toBeNull();
    });

    it('refuses a missing, non-numeric or zero-padded mask', () => {
        expect(parseCidr('192.0.2.0/')).toBeNull();
        expect(parseCidr('192.0.2.0/x')).toBeNull();
        expect(parseCidr('192.0.2.0/024')).toBeNull();
        expect(parseCidr('192.0.2.0/24/8')).toBeNull();
    });

    it('accepts /0 and the full-width mask', () => {
        expect(formatPrefix(cidr('10.0.0.0/0'))).toBe('0.0.0.0/0');
        expect(formatPrefix(cidr('192.0.2.1/32'))).toBe('192.0.2.1/32');
        expect(formatPrefix(cidr('2001:db8::1/128'))).toBe('2001:db8::1/128');
    });

    it('refuses a bare address with no mask', () => {
        // Guessing /32 would turn a typo into a prefix that matches one host
        // and looks like it works.
        expect(parseCidr('192.0.2.1')).toBeNull();
        expect(parseCidr('2001:db8::1')).toBeNull();
    });

    it('refuses an IPv4 prefix written in IPv6 notation, whose mask is ambiguous', () => {
        expect(parseCidr('::ffff:10.0.0.0/104')).toBeNull();
        expect(parseCidr('::ffff:10.0.0.0/8')).toBeNull();
    });
});

describe('formatPrefix', () => {
    it('compresses the leftmost longest zero run and never a single group', () => {
        expect(formatAddress(addr('2001:0:0:1:0:0:0:1'))).toBe('2001:0:0:1::1');
        expect(formatAddress(addr('2001:db8:0:1:1:1:1:1'))).toBe('2001:db8:0:1:1:1:1:1');
    });

    it('renders IPv6 in lowercase with no leading zeros', () => {
        expect(formatAddress(addr('2001:0DB8:0000:0000:0000:0000:0000:00AB'))).toBe('2001:db8::ab');
    });

    it('round-trips every canonical form through parseCidr', () => {
        for (const text of [
            '10.0.0.0/8',
            '192.168.1.0/24',
            '0.0.0.0/0',
            '2001:db8::/32',
            '::/0',
            '2001:0:0:1::/64',
            'fe80::/10',
        ]) {
            expect(formatPrefix(cidr(text))).toBe(text);
        }
    });
});

describe('prefixContains', () => {
    it('never matches across families', () => {
        // Widening IPv4 into IPv6 would let a genuine /104 claim IPv4 hosts.
        expect(prefixContains(cidr('::/0'), addr('10.0.0.1'))).toBe(false);
        expect(prefixContains(cidr('0.0.0.0/0'), addr('2001:db8::1'))).toBe(false);
        // The v6 prefix whose first four bytes spell 10.0.0.0 must not claim it.
        expect(prefixContains(cidr('a00:0::/32'), addr('10.0.0.0'))).toBe(false);
    });

    it('matches on a byte boundary', () => {
        expect(prefixContains(cidr('10.1.0.0/16'), addr('10.1.5.9'))).toBe(true);
        expect(prefixContains(cidr('10.1.0.0/16'), addr('10.2.5.9'))).toBe(false);
    });

    it('matches inside a byte', () => {
        expect(prefixContains(cidr('10.1.240.0/20'), addr('10.1.250.1'))).toBe(true);
        expect(prefixContains(cidr('10.1.240.0/20'), addr('10.1.239.1'))).toBe(false);
    });

    it('/0 contains everything of its family', () => {
        expect(prefixContains(cidr('0.0.0.0/0'), addr('203.0.113.9'))).toBe(true);
        expect(prefixContains(cidr('::/0'), addr('2001:db8::1'))).toBe(true);
    });

    it('a full-width prefix contains only itself', () => {
        expect(prefixContains(cidr('192.0.2.1/32'), addr('192.0.2.1'))).toBe(true);
        expect(prefixContains(cidr('192.0.2.1/32'), addr('192.0.2.2'))).toBe(false);
    });

    it('matches an IPv6 host written in a different but equal form', () => {
        expect(prefixContains(cidr('2001:db8::/32'), addr('2001:0db8:0000::0001'))).toBe(true);
    });

    it('matches a host typed as ::ffff:… against its IPv4 prefix', () => {
        expect(prefixContains(cidr('192.0.2.0/24'), addr('::ffff:192.0.2.9'))).toBe(true);
    });
});

describe('comparePrefixes', () => {
    it('gives one stable order for the same set, whatever order it arrives in', () => {
        const texts = ['10.2.0.0/16', '2001:db8::/32', '10.1.0.0/16', '10.1.0.0/24'];
        const sortOnce = [...texts].sort();
        const a = sortOnce.map(cidr).sort(comparePrefixes).map(formatPrefix);
        const b = [...texts].reverse().map(cidr).sort(comparePrefixes).map(formatPrefix);
        expect(a).toEqual(b);
        expect(a).toEqual(['10.1.0.0/16', '10.1.0.0/24', '10.2.0.0/16', '2001:db8::/32']);
    });
});
