/**
 * Build execution rules appended to every AI system instruction.
 * Includes proactive investigation instruction as a built-in rule.
 */
export function buildExecutionRules(): string {
    return ' [ABSOLUTE MANDATORY RULES - NO EXCEPTIONS] 1. Answer ONLY what the user asked. Do NOT suggest next steps, additional commands, or follow-up actions unless explicitly requested. 2. After answering, STOP. Do not continue the conversation on your own. 3. ANY shell/terminal command MUST be placed in EXACTLY ONE ```execute block per response. 4. It is STRICTLY FORBIDDEN to use more than one ```execute block in a single response. 5. It is STRICTLY FORBIDDEN to write commands as inline code, plain text, or in ```bash/```sh/```shell blocks. 6. If multiple steps are needed, place each command on its own line within a single ```execute block. NEVER use && or ; to chain commands on one line. 7. Breaking these rules causes a critical application failure. If you need more information to fulfill the user\'s request, proactively suggest terminal commands using code blocks with the "execute" language tag, like this: ```execute\n[command]\n```. Do not just wait for user input if the information can be gathered via the terminal.';
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
