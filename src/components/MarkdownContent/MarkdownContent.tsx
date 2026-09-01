import React from 'react';
import { tauriService } from '../../services/tauriService';
import { externalLinkFromClick } from '../../utils/htmlUtils';
import './MarkdownContent.css';

interface MarkdownContentProps {
    /**
     * HTML produced by `renderMarkdown` (marked + DOMPurify), optionally with
     * search `<mark>`s spliced in afterwards. The prop is named for the
     * invariant: this component never sanitizes, so the caller must hand over
     * something that already went through `renderMarkdown`.
     */
    sanitizedHtml: string;
    /** Extra classes appended to `md-content`. */
    className?: string;
    ref?: React.Ref<HTMLDivElement>;
}

/**
 * Renders markdown-derived HTML with the app's shared markdown styling.
 *
 * Used by the AI Chat pane for assistant replies and by the Log Viewer for
 * `.md` transcripts, so a conversation reads the same in both places by
 * construction rather than by two stylesheets being kept in sync by hand.
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({ sanitizedHtml, className, ref }) => (
    <div
        ref={ref}
        className={className ? `md-content ${className}` : 'md-content'}
        onClick={(e) => {
            // Links here are untrusted — an AI wrote them, or they came out of a
            // file in the user's log folder. Without interception a click is a
            // same-window top-level navigation that would replace the privileged
            // app UI in place. Route http(s) through the vetted opener instead.
            //
            // preventDefault() is unconditional on purpose: cancelling only when
            // externalLinkFromClick() returns a URL means any href it rejects
            // still navigates the app frame. That is the whole bug class here —
            // a scheme DOMPurify allows but this code does not recognise must
            // end as a dead click, never as a navigation away from the app.
            const anchor = e.target instanceof HTMLElement ? e.target.closest('a') : null;
            if (!anchor) return;
            e.preventDefault();
            const url = externalLinkFromClick(e.target);
            if (url) {
                void tauriService.openExternal(url).catch(() => {});
            }
        }}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
);
