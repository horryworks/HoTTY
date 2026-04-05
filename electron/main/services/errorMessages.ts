/**
 * Converts raw Node.js / library error messages into user-friendly text.
 *
 * The mapping covers common network error codes (ECONNREFUSED, ETIMEDOUT, etc.)
 * as well as protocol-specific messages from ssh2 and telnet-client.
 * Unknown messages are returned as-is so no information is lost.
 */

const ERROR_MAP: [RegExp, string][] = [
    // --- Network-level (Node.js) ---
    [/ECONNREFUSED/, 'Connection refused. The host may not be accepting connections on this port.'],
    [/ETIMEDOUT/, 'Connection timed out. The host may be unreachable.'],
    [/ECONNRESET/, 'Connection was reset by the remote host.'],
    [/ENOTFOUND/, 'Host not found. Please check the hostname.'],
    [/EHOSTUNREACH/, 'Host is unreachable. Please check the network path.'],
    [/ENETUNREACH/, 'Network is unreachable. Please check your network connection.'],
    [/EADDRINUSE/, 'The port is already in use.'],
    [/EPIPE/, 'Connection was closed unexpectedly.'],
    [/EAI_AGAIN/, 'DNS lookup timed out. Please check your DNS settings.'],

    // --- SSH-specific ---
    [/All configured authentication methods failed/, 'Username or password may be incorrect.'],
    [/Timed out while waiting for handshake/, 'SSH handshake timed out. The host may not be running an SSH server on this port.'],
    [/No matching host key/, 'No compatible host key algorithm. Check SSH algorithm settings.'],
    [/No matching key exchange/, 'No compatible key exchange algorithm. Check SSH algorithm settings.'],
    [/No matching cipher/, 'No compatible cipher algorithm. Check SSH algorithm settings.'],
    [/No matching mac/, 'No compatible MAC algorithm. Check SSH algorithm settings.'],

    // --- Telnet-specific ---
    [/Cannot connect/, 'Could not connect to the host.'],
    [/timeout/, 'Connection timed out.'],
];

/**
 * Translates a raw error message into a user-friendly string.
 * If no known pattern matches, the original message is returned unchanged.
 */
export function friendlyErrorMessage(raw: string): string {
    for (const [pattern, friendly] of ERROR_MAP) {
        if (pattern.test(raw)) {
            return `${friendly}\n${raw}`;
        }
    }
    return raw;
}
