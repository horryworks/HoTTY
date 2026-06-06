// ── AI message content segmentation ──
// Splits an AI response into typed, stable-keyed parts so that React never reuses
// a DOM node across the markdown(dangerouslySetInnerHTML) vs execute(children)
// boundary during streaming re-parses. Centralizes the fence parsing that was
// previously duplicated in AIChatPane.tsx (extractExecuteCommands + MessageContent).

// Splits on PAIRED (closed) fences; the captured group keeps the fenced block intact.
export const FENCE_SPLIT_RE = /(^```+[\s\S]*?^```+)/gm;
// Matches a single closed fence: language tag + body.
export const FENCE_MATCH_RE = /^```+(\w*)\s*\n?([\s\S]*?)\n?```+$/;
// Matches a trailing UNCLOSED opener (streaming tail). By construction closed pairs
// are already consumed by FENCE_SPLIT_RE, so a tail segment holds at most one
// unclosed opener — a single non-greedy `before` capture is sufficient. The opener
// must start a line.
export const OPEN_FENCE_RE = /^([\s\S]*?)(?:^|\n)```+(\w*)[ \t]*\n([\s\S]*)$/;

export type ContentPart =
    | { kind: 'markdown'; key: string; text: string }
    | { kind: 'execute'; key: string; command: string }
    | { kind: 'execute-pending'; key: string; command: string };

// Decide whether a fence body is an executable command block, and normalize the
// command (stripping an `execute` prefix when the language tag is absent/generic).
function classifyExecute(lang: string, body: string): { isExecute: boolean; command: string } {
    const l = lang.toLowerCase();
    let command = body.trim();
    const startsWithExecute = command.startsWith('execute\n') || command.startsWith('execute ');
    const isExecute =
        l === 'execute' ||
        (l === '' && startsWithExecute) ||
        ((l === 'bash' || l === 'sh' || l === 'shell') && startsWithExecute);
    if (isExecute && startsWithExecute) {
        command = command.replace(/^execute\s+/, '').trim();
    }
    return { isExecute, command };
}

export function segmentMessageContent(content: string): ContentPart[] {
    const out: ContentPart[] = [];
    // Keys are derived from the OUTPUT position (not the split-array index) and empty
    // split fragments are dropped. This keeps an execute block at the same position —
    // and thus the same `-exec` key — whether it is still streaming (pending, sitting
    // at the tail) or finished (closed, sitting between the empty fragments that
    // FENCE_SPLIT_RE produces around it). Same key => React updates the block in place
    // instead of remounting => no flicker/jump on close.
    const pushMarkdown = (text: string) => {
        if (text === '') return; // empty fragments around fences — skip for key stability
        out.push({ kind: 'markdown', key: `${out.length}-md`, text });
    };
    const pushExecute = (kind: 'execute' | 'execute-pending', command: string) => {
        out.push({ kind, key: `${out.length}-exec`, command });
    };
    content.split(FENCE_SPLIT_RE).forEach((part) => {
        const m = part.match(FENCE_MATCH_RE);
        if (m) {
            const { isExecute, command } = classifyExecute(m[1], m[2]);
            if (isExecute) pushExecute('execute', command);
            else pushMarkdown(part);
            return;
        }
        // No closed-fence match — check for a trailing UNCLOSED execute opener (streaming tail).
        const o = part.match(OPEN_FENCE_RE);
        if (o) {
            const { isExecute, command } = classifyExecute(o[2], o[3]);
            if (isExecute) {
                pushMarkdown(o[1]); // prose before the fence (skipped if empty)
                pushExecute('execute-pending', command);
                return;
            }
        }
        pushMarkdown(part);
    });
    return out;
}

// Completed (runnable) execute commands only — pending blocks are excluded so an
// incomplete command is never auto-run.
export function extractExecuteCommands(content: string): string[] {
    return segmentMessageContent(content)
        .filter((p): p is Extract<ContentPart, { kind: 'execute' }> => p.kind === 'execute')
        .map((p) => p.command);
}
