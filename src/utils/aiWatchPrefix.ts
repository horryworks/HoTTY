/**
 * Size the watched-terminal scrollback that is prepended to a chat send.
 *
 * A conversation can watch several terminals, and each one's watch buffer may
 * hold up to `watchBufferLimit` bytes (500 KB by default). Concatenated, that
 * comfortably exceeds the backend's 1 MB message cap — and a send rejected for
 * size never reaches a provider, so nothing would answer. The buffers have
 * already been read-and-cleared by then, so the scrollback would be lost too.
 *
 * Each section keeps its TAIL (the most recent output is what a question is
 * usually about) and says how much was left out, so the model knows the
 * beginning is missing rather than assuming the capture started there.
 */

/** Total bytes of scrollback allowed across every watched terminal, per send.
 *  Leaves room under the backend's 1,000,000-byte cap for the question itself
 *  and the section headers. */
export const MAX_WATCH_PREFIX_BYTES = 800 * 1024;

export interface WatchSection {
    name: string;
    text: string;
}

export interface FittedWatchSection extends WatchSection {
    /** Bytes dropped from the front of `text` to fit the budget (0 = intact). */
    omittedBytes: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Keep the last `maxBytes` of `text`, cut on a character boundary. */
function tailBytes(text: string, maxBytes: number): { text: string; omittedBytes: number } {
    const bytes = encoder.encode(text);
    if (bytes.length <= maxBytes) return { text, omittedBytes: 0 };
    let start = bytes.length - maxBytes;
    // Advance past UTF-8 continuation bytes so the cut never splits a character.
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
    return { text: decoder.decode(bytes.subarray(start)), omittedBytes: start };
}

/**
 * Trim `sections` so their combined text stays within `maxBytes`. An input
 * that already fits is returned untouched (every `omittedBytes` is 0). Over
 * budget, every section gets an equal share and keeps its tail; a section
 * already under its share is left whole and does not lend its slack to the
 * others (simple, predictable, and the loss is at most a few hundred KB of
 * old scrollback).
 */
export function fitWatchSections(sections: WatchSection[], maxBytes: number = MAX_WATCH_PREFIX_BYTES): FittedWatchSection[] {
    if (sections.length === 0) return [];
    const total = sections.reduce((n, s) => n + encoder.encode(s.text).length, 0);
    if (total <= maxBytes) return sections.map((s) => ({ ...s, omittedBytes: 0 }));
    const share = Math.max(1, Math.floor(maxBytes / sections.length));
    return sections.map((s) => ({ ...s, ...tailBytes(s.text, share) }));
}
