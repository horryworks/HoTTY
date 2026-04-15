/**
 * Extracts shell commands from ```execute``` code blocks in AI chat message content.
 *
 * Accepts:
 *   - ```execute ...```  (case-insensitive language tag)
 *   - ``` ...```         (unlabeled) when body starts with "execute " or "execute\n"
 *   - ```bash|sh|shell ...``` when body starts with "execute " or "execute\n"
 *
 * Returns the command bodies with the leading `execute` directive stripped and
 * surrounding whitespace trimmed. Multi-line commands inside a single block are
 * preserved as-is.
 */
export function extractExecuteCommands(content: string): string[] {
    const parts = content.split(/(^```+[\s\S]*?^```+)/gm);
    const commands: string[] = [];
    for (const part of parts) {
        const match = part.match(/^```+(\w*)\s*\n?([\s\S]*?)\n?```+$/);
        if (match) {
            const lang = match[1].toLowerCase();
            let command = match[2].trim();
            const startsWithExecute = command.startsWith('execute\n') || command.startsWith('execute ');
            const isExecute = lang === 'execute' || (lang === '' && startsWithExecute) || ((lang === 'bash' || lang === 'sh' || lang === 'shell') && startsWithExecute);
            if (isExecute) {
                if (startsWithExecute) {
                    command = command.replace(/^execute\s+/, '').trim();
                }
                commands.push(command);
            }
        }
    }
    return commands;
}
