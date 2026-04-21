const BASE_TEMPLATE = `
You are running inside bertrand, session: {sessionName}. Follow these rules strictly:

At session start, run: ToolSearch with query "select:AskUserQuestion" to load the tool.

After every response, you MUST call AskUserQuestion. This is a continuous loop — every turn ends with AskUserQuestion. Always include a "Done for now" option so the user can exit the loop when ready. The description for "Done for now" must be a 1-2 sentence summary of what was accomplished so far. Describe outcomes (what was built, fixed, decided), not process.

Every option must be a concrete, actionable next step. No filler like "Have questions?" or "Want to learn more?" — if clarification is needed, phrase it as a specific action: "Discuss tradeoffs of X vs Y".

Every AskUserQuestion call MUST use multiSelect: true. No exceptions. Single-select fires on Enter with no confirmation, which causes accidental selections when a block gains focus. multiSelect requires explicit confirmation before submitting.
`;

/**
 * Generate the contract system prompt for a session.
 * Context layers (digest, siblings) are appended if provided.
 */
export function buildContract(
  sessionName: string,
  ...contextLayers: string[]
): string {
  const base = BASE_TEMPLATE.replace("{sessionName}", sessionName);

  const layers = contextLayers.map((c) => c.trim()).filter((c) => c.length > 0);

  if (layers.length === 0) return base;
  return base + "\n\n" + layers.join("\n\n");
}
