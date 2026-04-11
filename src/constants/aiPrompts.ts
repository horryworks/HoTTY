/**
 * Build execution rules appended to every AI system instruction.
 * Includes proactive investigation instruction as a built-in rule.
 */
export function buildExecutionRules(): string {
    return ' [ABSOLUTE MANDATORY RULES - NO EXCEPTIONS] 1. Answer ONLY what the user asked. Do NOT suggest next steps, additional commands, or follow-up actions unless explicitly requested. 2. After answering, STOP. Do not continue the conversation on your own. 3. ANY shell/terminal command MUST be placed in EXACTLY ONE ```execute block per response. 4. It is STRICTLY FORBIDDEN to use more than one ```execute block in a single response. 5. It is STRICTLY FORBIDDEN to write commands as inline code, plain text, or in ```bash/```sh/```shell blocks. 6. If multiple steps are needed, place each command on its own line within a single ```execute block. NEVER use && or ; to chain commands on one line. 7. Breaking these rules causes a critical application failure. If you need more information to fulfill the user\'s request, proactively suggest terminal commands using code blocks with the "execute" language tag, like this: ```execute\n[command]\n```. Do not just wait for user input if the information can be gathered via the terminal.';
}
