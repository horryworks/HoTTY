import { describe, it, expect } from 'vitest';
import { friendlyErrorMessage } from './errorMessages';

describe('friendlyErrorMessage', () => {
    it('converts ECONNREFUSED', () => {
        expect(friendlyErrorMessage('connect ECONNREFUSED 192.168.1.1:22')).toBe(
            'Connection refused. The host may not be accepting connections on this port.'
        );
    });

    it('converts ETIMEDOUT', () => {
        expect(friendlyErrorMessage('connect ETIMEDOUT 10.0.0.1:22')).toBe(
            'Connection timed out. The host may be unreachable.'
        );
    });

    it('converts ECONNRESET', () => {
        expect(friendlyErrorMessage('read ECONNRESET')).toBe(
            'Connection was reset by the remote host.'
        );
    });

    it('converts ENOTFOUND', () => {
        expect(friendlyErrorMessage('getaddrinfo ENOTFOUND myhost.example.com')).toBe(
            'Host not found. Please check the hostname.'
        );
    });

    it('converts EHOSTUNREACH', () => {
        expect(friendlyErrorMessage('connect EHOSTUNREACH 10.0.0.1:22')).toBe(
            'Host is unreachable. Please check the network path.'
        );
    });

    it('converts ENETUNREACH', () => {
        expect(friendlyErrorMessage('connect ENETUNREACH 10.0.0.1:22')).toBe(
            'Network is unreachable. Please check your network connection.'
        );
    });

    it('converts EAI_AGAIN', () => {
        expect(friendlyErrorMessage('getaddrinfo EAI_AGAIN myhost.local')).toBe(
            'DNS lookup timed out. Please check your DNS settings.'
        );
    });

    it('converts SSH auth failure', () => {
        expect(friendlyErrorMessage('All configured authentication methods failed')).toBe(
            'Username or password may be incorrect.'
        );
    });

    it('converts SSH handshake timeout', () => {
        expect(friendlyErrorMessage('Timed out while waiting for handshake')).toBe(
            'SSH handshake timed out. The host may not be running an SSH server on this port.'
        );
    });

    it('converts SSH no matching host key', () => {
        expect(friendlyErrorMessage('No matching host key algorithm')).toBe(
            'No compatible host key algorithm. Check SSH algorithm settings.'
        );
    });

    it('converts SSH no matching key exchange', () => {
        expect(friendlyErrorMessage('No matching key exchange algorithm')).toBe(
            'No compatible key exchange algorithm. Check SSH algorithm settings.'
        );
    });

    it('converts SSH no matching cipher', () => {
        expect(friendlyErrorMessage('No matching cipher')).toBe(
            'No compatible cipher algorithm. Check SSH algorithm settings.'
        );
    });

    it('returns unknown messages unchanged', () => {
        const unknown = 'Something completely unexpected happened';
        expect(friendlyErrorMessage(unknown)).toBe(unknown);
    });
});
