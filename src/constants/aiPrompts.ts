/**
 * Build execution rules appended to every AI system instruction.
 * Includes proactive investigation instruction as a built-in rule.
 */
export function buildExecutionRules(): string {
    return ' [ABSOLUTE MANDATORY RULES - NO EXCEPTIONS] 1. Answer ONLY what the user asked. Do NOT suggest next steps, additional commands, or follow-up actions unless explicitly requested. 2. After answering, STOP. Do not continue the conversation on your own. 3. ANY shell/terminal command MUST be placed in EXACTLY ONE ```execute block per response. 4. It is STRICTLY FORBIDDEN to use more than one ```execute block in a single response. 5. It is STRICTLY FORBIDDEN to write commands as inline code, plain text, or in ```bash/```sh/```shell blocks. 6. If multiple steps are needed, place each command on its own line within a single ```execute block. NEVER use && or ; to chain commands on one line. 7. Breaking these rules causes a critical application failure. If you need more information to fulfill the user\'s request, proactively suggest terminal commands using code blocks with the "execute" language tag, like this: ```execute\n[command]\n```. Do not just wait for user input if the information can be gathered via the terminal.';
}

/**
 * Section header prefixing ONE watched terminal's scrollback when a chat tab
 * aggregates several watched terminals into a single message to the AI. Kept out
 * of i18n on purpose — it is an AI-prompt token the model reads, not UI chrome.
 */
export function watchedOutputSection(name: string): string {
  return `[Watched Terminal Output: ${name}]`;
}

/**
 * System-prompt block (appended at SEND time) that lists the terminals a chat tab
 * currently watches and teaches the AI to route a command to one of them with a
 * `target=<alias>` tag on its single execute fence (Phase 2 multi-watch). Returns
 * '' for 0–1 watched terminals — with nothing to disambiguate the single-watch
 * behavior (and prompt) is unchanged. Kept out of i18n: this is an AI-prompt token.
 */
export function buildWatchTargetsBlock(
    terminals: { alias: string; displayName: string; live: boolean }[],
): string {
    if (terminals.length < 2) return '';
    const list = terminals
        .map((t) => `${t.alias} (${t.displayName}${t.live ? '' : ', disconnected'})`)
        .join(', ');
    return `\n\n[Watched Terminals] You are watching ${terminals.length} terminals; their output is aggregated above under "[Watched Terminal Output: <name>]" sections. When your single \`\`\`execute block should run on a SPECIFIC terminal, tag the fence with that terminal's alias — e.g. \`\`\`execute target=${terminals[0].alias} — using ONLY an alias from this list and exactly ONE target. Aliases: ${list}. If you omit target=, the command runs on the most recently used terminal.`;
}

/** The canonical language-selector value meaning "let the model decide". */
export const AUTO_LANGUAGE = 'Auto';

/**
 * Auto-kickoff message injected into a Network Expert chat the moment it links to
 * a live terminal with an empty conversation. It plays the role of the user's
 * "first message" so the persona's mandatory start-of-session protocol (device
 * identification + paging disable) runs WITHOUT the user having to type anything.
 * Kept terse — the protocol detail lives in the persona's system prompt; this only
 * needs to (a) trigger a turn and (b) signal there is no real question yet so the
 * model stops after the prep instead of inventing a request to answer.
 */
export const NETWORK_EXPERT_KICKOFF =
    'Session started. Run the start-of-session protocol now (identify the device, then disable paging). I have no question yet — after the prep, briefly state the detected device/OS and then wait for my question.';

/**
 * Lightweight re-prep injected when a Network Expert chat's linked terminal
 * RECONNECTS to the SAME device (a new SSH session ⇒ paging is re-enabled) while a
 * conversation is already in progress. Unlike the full kickoff it does NOT clear
 * the chat or re-identify the device — the model still knows the vendor/OS from the
 * preserved context, so it only needs to re-disable paging. One command, then wait.
 */
export const NETWORK_EXPERT_RECONNECT_PREP =
    'The terminal session was just reconnected, so paging is likely re-enabled. Re-run ONLY the paging-disable command for this device (the equivalent of Cisco `terminal length 0`). Do NOT run show version again and do NOT answer anything else — just that one command, then wait for my question.';

/**
 * Append a routing directive to a Network-Expert kickoff / reconnect-prep message
 * so that, when a chat watches SEVERAL terminals, the start-of-session protocol
 * runs on ONE specific terminal (named by its alias) and its execute blocks are
 * tagged `target=<alias>`. Used only for multi-watch (≥2 terminals); a single
 * watched terminal uses the bare message.
 */
export function withTargetDirective(message: string, alias: string): string {
    return `${message}\n\n[Apply this ONLY to the watched terminal aliased "${alias}": identify/act on that terminal and tag every execute block with target=${alias}. Ignore the other watched terminals for now.]`;
}

/**
 * Build the language directive appended to an AI system instruction.
 *
 * Returns an empty string for `English` (the model's default) and for `Auto`
 * (let the model match the user's language) — any other value asks the model to
 * answer in that language. Centralized so every AI entry point treats the
 * language selection identically; in particular `Auto` must never leak into the
 * prompt as a literal "answer in Auto" instruction.
 */
export function languageDirective(lang: string | null | undefined): string {
    if (!lang || lang === 'English' || lang === AUTO_LANGUAGE) return '';
    return ` You MUST answer in ${lang}.`;
}
