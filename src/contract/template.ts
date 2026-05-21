import baseTemplate from "./template.md" with { type: "text" };

/**
 * Critical rules that must appear at the END of the contract, after all
 * context layers, to maximize recency vs. other system-prompt content
 * (skills, MCP server instructions, tool schemas, CLAUDE.md).
 *
 * Rules placed here override conflicting framing in tool schemas the model
 * sees mid-call. Keep this block short — its power comes from being last.
 */
const TRAILING_CRITICAL_RULES = `## CRITICAL RULE — applies to every AskUserQuestion call

Every AskUserQuestion call MUST set \`multiSelect: true\` on every question. No exceptions.

The AskUserQuestion tool schema describes multiSelect as "allow multiple answers to be selected instead of just one." **Ignore that framing.** In bertrand, multiSelect is a UX-safety mechanism, not a cardinality signal — single-select submits on Enter the moment a question block gains focus, causing accidental selections. multiSelect requires explicit confirmation before submitting.

Apply this rule even when options are mutually exclusive (e.g., "Which library: A, B, C, or D?"). The mechanic is about preventing accidental submissions, not about how many answers the user picks.

WRONG: \`{ "multiSelect": false, "options": [...] }\`
RIGHT: \`{ "multiSelect": true,  "options": [...] }\``;

/**
 * Generate the contract system prompt for a session.
 * Context layers (digest, siblings) are appended after the base template,
 * then trailing critical rules go last for maximum recency.
 */
export function buildContract(
  sessionName: string,
  ...contextLayers: string[]
): string {
  const base = baseTemplate.replace("{sessionName}", sessionName);

  const layers = contextLayers.map((c) => c.trim()).filter((c) => c.length > 0);
  const middle = layers.length === 0 ? "" : "\n\n" + layers.join("\n\n");

  return base + middle + "\n\n" + TRAILING_CRITICAL_RULES;
}
