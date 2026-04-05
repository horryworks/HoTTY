import { describe, it, expect } from 'vitest';
import { friendlyErrorMessage } from './errorMessages';

describe('friendlyErrorMessage', () => {
    it('converts ECONNREFUSED and appends raw message', () => {
        const raw = 'connect ECONNREFUSED 192.168.1.1:22';
        expect(friendlyErrorMessage(raw)).toBe(
            `Connection refused. The host may not be accepting connections on this port.\n${raw}`
        );
    });

    it('converts ETIMEDOUT and appends raw message', () => {
        const raw = 'connect ETIMEDOUT 10.0.0.1:22';
        expect(friendlyErrorMessage(raw)).toBe(
            `Connection timed out. The host may be unreachable.\n${raw}`
        );
    });

    it('converts ECONNRESET and appends raw message', () => {
        const raw = 'read ECONNRESET';
        expect(friendlyErrorMessage(raw)).toBe(
            `Connection was reset by the remote host.\n${raw}`
        );
    });

    it('converts ENOTFOUND and appends raw message', () => {
        const raw = 'getaddrinfo ENOTFOUND myhost.example.com';
        expect(friendlyErrorMessage(raw)).toBe(
            `Host not found. Please check the hostname.\n${raw}`
        );
    });

    it('converts EHOSTUNREACH and appends raw message', () => {
        const raw = 'connect EHOSTUNREACH 10.0.0.1:22';
        expect(friendlyErrorMessage(raw)).toBe(
            `Host is unreachable. Please check the network path.\n${raw}`
        );
    });

    it('converts ENETUNREACH and appends raw message', () => {
        const raw = 'connect ENETUNREACH 10.0.0.1:22';
        expect(friendlyErrorMessage(raw)).toBe(
            `Network is unreachable. Please check your network connection.\n${raw}`
        );
    });

    it('converts EAI_AGAIN and appends raw message', () => {
        const raw = 'getaddrinfo EAI_AGAIN myhost.local';
        expect(friendlyErrorMessage(raw)).toBe(
            `DNS lookup timed out. Please check your DNS settings.\n${raw}`
        );
    });

    it('converts SSH auth failure and appends raw message', () => {
        const raw = 'All configured authentication methods failed';
        expect(friendlyErrorMessage(raw)).toBe(
            `Username or password may be incorrect.\n${raw}`
        );
    });

    it('converts SSH handshake timeout and appends raw message', () => {
        const raw = 'Timed out while waiting for handshake';
        expect(friendlyErrorMessage(raw)).toBe(
            `SSH handshake timed out. The host may not be running an SSH server on this port.\n${raw}`
        );
    });

    it('converts SSH no matching host key and appends raw message', () => {
        const raw = 'No matching host key algorithm';
        expect(friendlyErrorMessage(raw)).toBe(
            `No compatible host key algorithm. Check SSH algorithm settings.\n${raw}`
        );
    });

    it('converts SSH no matching key exchange and appends raw message', () => {
        const raw = 'No matching key exchange algorithm';
        expect(friendlyErrorMessage(raw)).toBe(
            `No compatible key exchange algorithm. Check SSH algorithm settings.\n${raw}`
        );
    });

    it('converts SSH no matching cipher and appends raw message', () => {
        const raw = 'No matching cipher';
        expect(friendlyErrorMessage(raw)).toBe(
            `No compatible cipher algorithm. Check SSH algorithm settings.\n${raw}`
        );
    });

    it('returns unknown messages unchanged', () => {
        const unknown = 'Something completely unexpected happened';
        expect(friendlyErrorMessage(unknown)).toBe(unknown);
    });
});
