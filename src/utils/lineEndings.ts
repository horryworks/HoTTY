/** Normalize a buffer's line endings to the given style. Goes via LF first so
 *  mixed CRLF/LF input collapses cleanly (avoids \r\r\n doubling). */
export function normalizeLineEnding(content: string, ending: 'CRLF' | 'LF'): string {
  const lf = content.replace(/\r\n/g, '\n');
  return ending === 'CRLF' ? lf.replace(/\n/g, '\r\n') : lf;
}
