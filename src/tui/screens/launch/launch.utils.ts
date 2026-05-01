import { KEY_DISPLAY } from "./launch.constants";

export function formatBindings(
  bindings: Array<{ label: string; description: string }>,
): string {
  return bindings
    .filter((b) => b.label)
    .map((b) => `${KEY_DISPLAY[b.description] ?? b.description} ${b.label}`)
    .join(" · ");
}
