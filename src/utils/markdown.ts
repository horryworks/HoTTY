import { marked } from 'marked';
import { sanitizeHtml } from './htmlUtils';

/**
 * Markdown → HTML, sanitized.
 *
 * The single place this app turns markdown into markup. Both callers render the
 * result with `dangerouslySetInnerHTML`, so the sanitize step is folded in here
 * rather than left to the call site: there is no way to obtain unsanitized HTML
 * from this module, and `MarkdownContent` only accepts what this returns.
 *
 * `marked` runs on stock defaults (GFM, `breaks: false`, no syntax
 * highlighting) — deliberately, so an AI reply and the transcript of that same
 * reply in the Log Viewer are parsed identically.
 */
export function renderMarkdown(source: string): string {
    return sanitizeHtml(marked.parse(source, { async: false }) as string);
}
