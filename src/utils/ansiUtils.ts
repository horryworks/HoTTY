/**
 * Strip ANSI/VT escape sequences and OSC sequences from a string.
 * Also normalizes CR/LF line endings to LF.
 */
export function stripAnsiCodes(data: string): string {
    return data
        // Strip OSC sequences (e.g. window title)
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b][^\x07\x1b]*(\x07|\x1b\\)/g, '')
        // Strip CSI / other escape sequences
        // eslint-disable-next-line no-control-regex
        .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
        // Normalize CRLF / bare CR to LF
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
