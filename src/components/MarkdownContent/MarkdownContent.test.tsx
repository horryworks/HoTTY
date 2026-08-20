import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MarkdownContent } from './MarkdownContent';
import { tauriService } from '../../services/tauriService';

vi.mock('../../services/tauriService', () => ({
    tauriService: {
        openExternal: vi.fn().mockResolvedValue(undefined),
    },
}));

const mockOpenExternal = vi.mocked(tauriService.openExternal);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('MarkdownContent rendering', () => {
    it('renders the HTML it is handed', () => {
        const { container } = render(
            <MarkdownContent sanitizedHtml="<p>hello <strong>world</strong></p>" />,
        );
        expect(container.querySelector('strong')?.textContent).toBe('world');
    });

    it('always carries the shared md-content class', () => {
        const { container } = render(<MarkdownContent sanitizedHtml="<p>x</p>" />);
        expect(container.firstElementChild?.className).toBe('md-content');
    });

    it('appends an extra className rather than replacing md-content', () => {
        // The AI Chat pane relies on this: its inline variant is styled by
        // `ai-chat-markdown-inline` on top of the shared markdown rules.
        const { container } = render(
            <MarkdownContent sanitizedHtml="<p>x</p>" className="ai-chat-markdown-inline" />,
        );
        expect(container.firstElementChild?.className).toBe('md-content ai-chat-markdown-inline');
    });

    it('exposes the host element through ref', () => {
        // The Log Viewer needs the node to find its <mark>s by ordinal.
        const ref = React.createRef<HTMLDivElement>();
        render(<MarkdownContent sanitizedHtml="<p>x</p>" ref={ref} />);
        expect(ref.current).toBeInstanceOf(HTMLDivElement);
        expect(ref.current?.classList.contains('md-content')).toBe(true);
    });
});

describe('MarkdownContent link interception', () => {
    // Links here are untrusted — an AI wrote them, or they came out of a file in
    // the user's log folder. A plain click would be a top-level navigation that
    // replaces the privileged app window in place.

    it('routes an http(s) link through the vetted opener instead of navigating', () => {
        render(<MarkdownContent sanitizedHtml='<p><a href="https://example.com/guide">docs</a></p>' />);
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        screen.getByText('docs').dispatchEvent(event);

        expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/guide');
        expect(event.defaultPrevented).toBe(true);
    });

    it('intercepts a click that landed on an element nested inside the link', () => {
        render(
            <MarkdownContent sanitizedHtml='<p><a href="http://example.com/x"><strong>bold link</strong></a></p>' />,
        );
        fireEvent.click(screen.getByText('bold link'));
        expect(mockOpenExternal).toHaveBeenCalledWith('http://example.com/x');
    });

    it('ignores a click on ordinary text', () => {
        render(<MarkdownContent sanitizedHtml="<p>just prose</p>" />);
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        screen.getByText('just prose').dispatchEvent(event);

        expect(mockOpenExternal).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('leaves a non-http scheme alone', () => {
        render(<MarkdownContent sanitizedHtml='<p><a href="mailto:someone@example.com">mail</a></p>' />);
        fireEvent.click(screen.getByText('mail'));
        expect(mockOpenExternal).not.toHaveBeenCalled();
    });

    it('survives a rejected open without throwing', () => {
        // openExternal rejects when the URL fails the backend allowlist, or when
        // the user declines its confirm dialog. Neither is an app error.
        mockOpenExternal.mockRejectedValueOnce(new Error('not allowed'));
        render(<MarkdownContent sanitizedHtml='<p><a href="https://example.com/">x</a></p>' />);
        expect(() => fireEvent.click(screen.getByText('x'))).not.toThrow();
    });
});
