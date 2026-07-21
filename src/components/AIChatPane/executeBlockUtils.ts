// ── AI message content segmentation ──
// Splits an AI response into typed, stable-keyed parts so that React never reuses
// a DOM node across the markdown(dangerouslySetInnerHTML) vs execute(children)
// boundary during streaming re-parses. Centralizes the fence parsing that was
// previously duplicated in AIChatPane.tsx (extractExecuteCommands + MessageContent).

// Splits on PAIRED (closed) fences; the captured group keeps the fenced block intact.
const FENCE_SPLIT_RE = /(^```+[\s\S]*?^```+)/gm;
// Matches a single closed fence: info string (language tag + attributes, e.g.
// `execute target=web-01`) + body. The info string is the whole first line.
const FENCE_MATCH_RE = /^```+([^\n]*)\n?([\s\S]*?)\n?```+$/;
// Matches a trailing UNCLOSED opener (streaming tail). By construction closed pairs
// are already consumed by FENCE_SPLIT_RE, so a tail segment holds at most one
// unclosed opener — a single non-greedy `before` capture is sufficient. The opener
// must start a line.
const OPEN_FENCE_RE = /^([\s\S]*?)(?:^|\n)```+([^\n]*)\n([\s\S]*)$/;

export type ContentPart =
    | { kind: 'markdown'; key: string; text: string }
    | { kind: 'execute'; key: string; command: string; target?: string }
    | { kind: 'execute-pending'; key: string; command: string; target?: string };

// Decide whether a fence is an executable command block, normalize the command
// (stripping an `execute` prefix when the language tag is absent/generic), and
// extract a `target=<alias>` attribute (Phase 2 multi-watch routing). The returned
// `command` NEVER contains the `target=` text — the attribute is parsed off the
// fence info line (and the inline-execute first line) and kept separate, so the
// safety classifier and the PTY only ever see the bare command.
function classifyExecute(info: string, body: string): { isExecute: boolean; command: string; target?: string } {
    const infoTrim = info.trim();
    const spaceIdx = infoTrim.search(/\s/);
    const lang = (spaceIdx === -1 ? infoTrim : infoTrim.slice(0, spaceIdx)).toLowerCase();
    let attrText = spaceIdx === -1 ? '' : infoTrim.slice(spaceIdx + 1);

    let command = body.trim();
    const startsWithExecute = command === 'execute' || command.startsWith('execute\n') || command.startsWith('execute ');
    const isExecute =
        lang === 'execute' ||
        (lang === '' && startsWithExecute) ||
        ((lang === 'bash' || lang === 'sh' || lang === 'shell') && startsWithExecute);
    if (!isExecute) return { isExecute: false, command: body.trim() };

    // Inline-execute fallback (language absent/generic, body opens with `execute`):
    // the FIRST body line may carry attributes too, e.g. `execute target=web-01`.
    // Pull them into attrText and drop that line from the command.
    if (startsWithExecute) {
        const nl = command.indexOf('\n');
        const firstLine = nl === -1 ? command : command.slice(0, nl);
        attrText += ' ' + firstLine.replace(/^execute\s*/, '');
        command = (nl === -1 ? '' : command.slice(nl + 1)).trim();
    }
    const targetMatch = attrText.match(/target=([A-Za-z0-9._-]+)/i);
    return { isExecute: true, command, target: targetMatch ? targetMatch[1] : undefined };
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
    const pushExecute = (kind: 'execute' | 'execute-pending', command: string, target?: string) => {
        out.push({ kind, key: `${out.length}-exec`, command, ...(target ? { target } : {}) });
    };
    content.split(FENCE_SPLIT_RE).forEach((part) => {
        const m = part.match(FENCE_MATCH_RE);
        if (m) {
            const { isExecute, command, target } = classifyExecute(m[1], m[2]);
            if (isExecute) pushExecute('execute', command, target);
            else pushMarkdown(part);
            return;
        }
        // No closed-fence match — check for a trailing UNCLOSED execute opener (streaming tail).
        const o = part.match(OPEN_FENCE_RE);
        if (o) {
            const { isExecute, command, target } = classifyExecute(o[2], o[3]);
            if (isExecute) {
                pushMarkdown(o[1]); // prose before the fence (skipped if empty)
                pushExecute('execute-pending', command, target);
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
    return extractExecuteBlocks(content).map((b) => b.command);
}

// Completed execute blocks with their optional `target=<alias>` routing hint
// (Phase 2). Pending (unclosed) blocks are excluded so an incomplete command is
// never auto-run. `command` is always the bare command (no `target=`).
export function extractExecuteBlocks(content: string): { command: string; target?: string }[] {
    return segmentMessageContent(content)
        .filter((p): p is Extract<ContentPart, { kind: 'execute' }> => p.kind === 'execute')
        .map((p) => ({ command: p.command, target: p.target }));
}
