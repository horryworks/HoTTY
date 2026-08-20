// Helpers for rendering a `.md` log — an AI Chat transcript — as formatted
// markdown in the Log Viewer.
//
// The AI Chat pane writes its transcripts as real markdown documents
// (`services/chat_log.rs`), so the same `renderMarkdown` the pane uses for a
// live reply reproduces that reply here. What this module adds is the piece the
// pane never needs: splicing the find bar's `<mark>`s into HTML that has
// already been parsed, without going back through the markdown source.
//
// Unlike `logSearch.ts` / `logCsv.ts` — which keep highlighting as plain data
// because they render inert text — this view is `dangerouslySetInnerHTML`, so
// the marks have to live in the HTML. They are still built as real DOM elements
// (`createElement` + `textContent`), never by string concatenation, so no input
// text can become markup on the way through.

import { MAX_MATCHES, splitByMatches } from './logSearch';

/**
 * Largest transcript that gets formatted. Past this the file is shown as raw
 * text with a notice.
 *
 * The backend reads files up to 50 MB (`commands/log_viewer.rs`), and both
 * `marked` and the highlight walk below are synchronous — a 50 MB markdown file
 * would lock the UI thread for seconds. A chat transcript is orders of
 * magnitude smaller than this ceiling; anything above it is not the file this
 * feature exists for.
 */
export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

/** Whether a log file should be offered as formatted markdown. Extension-only. */
export function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith('.md');
}

export interface HighlightHtmlResult {
  /** `html` with matches wrapped in `<mark>`. */
  html: string;
  /** Number of highlighted matches — equals the cap when `truncated`. */
  total: number;
  /** True when the scan stopped at the cap and later matches are unhighlighted. */
  truncated: boolean;
}

/**
 * Wrap every match of `re` in `html` with
 * `<mark class="log-viewer-mark" data-match-index="N">`.
 *
 * `html` must already be sanitized (i.e. it came from `renderMarkdown`); this
 * function only ever inserts `<mark>` elements it creates itself, so it cannot
 * introduce markup that was not already there.
 *
 * The ordinal lives in `data-match-index` rather than in a `.current` class so
 * stepping through matches is a class toggle on one element, not a re-parse of
 * the whole document.
 *
 * Known limits, both inherent to searching rendered output:
 *  - A match cannot span an element boundary. `**bo**ld` becomes
 *    `<strong>bo</strong>ld`, so "bold" is not found in the formatted view.
 *  - Counts differ from the raw view, which searches the markdown source and so
 *    can also match `#`, `**`, and the rest of the syntax.
 */
export function highlightHtml(
  html: string,
  re: RegExp,
  cap: number = MAX_MATCHES,
): HighlightHtmlResult {
  const root = document.createElement('div');
  root.innerHTML = html;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  // Collect first: wrapping a text node detaches it, which would derail a
  // walker that is still positioned on it.
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    if (node.nodeValue) textNodes.push(node as Text);
  }

  let total = 0;
  let truncated = false;

  for (const textNode of textNodes) {
    if (total >= cap) {
      truncated = true;
      break;
    }
    const { segments, truncated: hitCap } = splitByMatches(textNode.data, re, cap - total);
    if (hitCap) truncated = true;
    // No match in this node — leave it exactly as it is.
    if (!segments.some((s) => s.isMatch)) continue;

    const frag = document.createDocumentFragment();
    for (const seg of segments) {
      if (!seg.isMatch) {
        frag.appendChild(document.createTextNode(seg.text));
        continue;
      }
      const mark = document.createElement('mark');
      mark.className = 'log-viewer-mark';
      mark.dataset.matchIndex = String(total);
      mark.textContent = seg.text;
      frag.appendChild(mark);
      total += 1;
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  return { html: root.innerHTML, total, truncated };
}
