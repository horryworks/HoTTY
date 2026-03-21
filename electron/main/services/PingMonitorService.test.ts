import { describe, it, expect } from 'vitest';
import { isValidPingTarget } from './PingMonitorService';

describe('PingMonitorService', () => {
    describe('isValidPingTarget', () => {
        it('accepts valid IPv4 addresses', () => {
            expect(isValidPingTarget('192.168.1.1')).toBe(true);
            expect(isValidPingTarget('10.0.0.1')).toBe(true);
            expect(isValidPingTarget('255.255.255.255')).toBe(true);
            expect(isValidPingTarget('8.8.8.8')).toBe(true);
        });

        it('accepts valid hostnames', () => {
            expect(isValidPingTarget('google.com')).toBe(true);
            expect(isValidPingTarget('my-server.example.com')).toBe(true);
            expect(isValidPingTarget('server01')).toBe(true);
            expect(isValidPingTarget('a')).toBe(true);
        });

        it('accepts IPv6 addresses', () => {
            expect(isValidPingTarget('::1')).toBe(true);
            expect(isValidPingTarget('fe80::1')).toBe(true);
        });

        it('rejects empty strings', () => {
            expect(isValidPingTarget('')).toBe(false);
        });

        it('rejects strings with spaces', () => {
            expect(isValidPingTarget('hello world')).toBe(false);
        });

        it('rejects strings with shell metacharacters', () => {
            expect(isValidPingTarget('127.0.0.1; rm -rf /')).toBe(false);
            expect(isValidPingTarget('host|evil')).toBe(false);
            expect(isValidPingTarget('$(whoami)')).toBe(false);
            expect(isValidPingTarget('host&evil')).toBe(false);
        });

        it('rejects strings starting with special characters', () => {
            expect(isValidPingTarget('.example.com')).toBe(false);
            expect(isValidPingTarget('-example.com')).toBe(false);
        });

        it('rejects strings exceeding 253 characters', () => {
            const longHost = 'a'.repeat(254);
            expect(isValidPingTarget(longHost)).toBe(false);
        });

        it('accepts strings at exactly 253 characters', () => {
            const maxHost = 'a'.repeat(253);
            expect(isValidPingTarget(maxHost)).toBe(true);
        });
    });
});
