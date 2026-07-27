// Pure search helpers for the Log Viewer's in-log find bar.
//
// The backend reads whole log files up to 50 MB (`commands/log_viewer.rs`), and
// the project has no virtualization library, so every function here is bounded
// by an explicit match cap. Highlighting is expressed as plain data (segments)
// so the component can render it with React elements — never innerHTML.

/** Hard ceiling on matches collected per search, in either display mode. */
export const MAX_MATCHES = 5000;

export interface SearchOptions {
  caseSensitive: boolean;
  useRegex: boolean;
}

/** A run of text, flagged as either a match or the plain text around it. */
export interface Segment {
  text: string;
  isMatch: boolean;
}

export interface SplitResult {
  segments: Segment[];
  /** Number of highlighted matches — equals the cap when `truncated`. */
  total: number;
  /** True when the scan stopped at the cap and later matches are unhighlighted. */
  truncated: boolean;
}

export interface FilterResult {
  lines: string[];
  truncated: boolean;
}

/** Escape a literal query so it can be used as a regex source. */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the global search regex, or return null when there is nothing to search
 * for (empty query) or the user's regex does not compile.
 */
export function buildSearchRegex(query: string, opts: SearchOptions): RegExp | null {
  if (!query) return null;
  const source = opts.useRegex ? query : escapeRegExp(query);
  const flags = opts.caseSensitive ? 'g' : 'gi';
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/**
 * Split `text` into alternating plain / match segments.
 *
 * The resulting DOM cost is O(matches), not O(lines) — a 50 MB log with 12 hits
 * produces 25 segments — and `segments.map(s => s.text).join('')` always equals
 * the input, so highlighting can never alter what the log says.
 */
export function splitByMatches(text: string, re: RegExp, cap: number = MAX_MATCHES): SplitResult {
  const segments: Segment[] = [];
  let total = 0;
  let truncated = false;
  let last = 0;

  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Zero-length matches (`a*`, `^`, `\b`) never advance lastIndex and would
    // spin forever. Step past them; there is nothing to highlight either.
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    if (total >= cap) {
      truncated = true;
      break;
    }
    if (m.index > last) segments.push({ text: text.slice(last, m.index), isMatch: false });
    segments.push({ text: m[0], isMatch: true });
    last = m.index + m[0].length;
    total++;
  }

  if (last < text.length) segments.push({ text: text.slice(last), isMatch: false });
  return { segments, total, truncated };
}

/** Collect the lines of `content` that contain at least one match, up to `cap`. */
export function filterMatchingLines(
  content: string,
  re: RegExp,
  cap: number = MAX_MATCHES,
): FilterResult {
  const lines: string[] = [];
  let truncated = false;

  for (const line of content.split('\n')) {
    re.lastIndex = 0;
    if (!re.test(line)) continue;
    if (lines.length >= cap) {
      truncated = true;
      break;
    }
    lines.push(line);
  }

  return { lines, truncated };
}
