export const TERMINAL_OUTPUT_RE = /^Terminal Output \(Command: ([\s\S]*?)\):\n([\s\S]*)$/;

export function parseTerminalOutputMessage(content: string): { cmd: string; output: string } | null {
    if (!content.startsWith('Terminal Output (Command:')) return null;
    const m = content.match(TERMINAL_OUTPUT_RE);
    return m ? { cmd: m[1], output: m[2] } : null;
}
