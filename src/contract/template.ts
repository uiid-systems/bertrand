import baseTemplate from "./template.md" with { type: "text" };

/**
 * Generate the contract system prompt for a session.
 * Soft guidance only — hard rules (multiSelect, Done-for-now exit) are enforced
 * by hooks in `src/hooks/scripts.ts` so they survive contexts where the contract
 * doesn't reach the agent (subagents, background jobs, direct `claude` invocations).
 */
export function buildContract(
  sessionName: string,
  ...contextLayers: string[]
): string {
  const base = baseTemplate.replace("{sessionName}", sessionName);

  const layers = contextLayers.map((c) => c.trim()).filter((c) => c.length > 0);
  if (layers.length === 0) return base;

  return base + "\n\n" + layers.join("\n\n");
}
