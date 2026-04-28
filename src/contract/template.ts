import baseTemplate from "./template.md" with { type: "text" };

/**
 * Generate the contract system prompt for a session.
 * Context layers (digest, siblings) are appended if provided.
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
