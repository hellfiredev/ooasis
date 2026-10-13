/** Tools whose output is shown to the user in the chat / saved log / export. */
const TOOLS_WITH_VISIBLE_OUTPUT: ReadonlySet<string> = new Set(['run_terminal']);

export function shouldShowToolOutput(toolName: string): boolean {
  return TOOLS_WITH_VISIBLE_OUTPUT.has(toolName);
}
