import baseTemplate from "./template.md" with { type: "text" };
import rulesTemplate from "./rules.md" with { type: "text" };

/**
 * The session rules, verbatim from `rules.md` — edit that file to change them.
 *
 * They live in their own file rather than inline in `template.md` because they
 * ship through two channels with different lifetimes: once in the full contract
 * at launch, and again in the per-prompt reminder. Splitting them keeps the
 * tweakable half in one place and spares the reminder from parsing markdown
 * back apart at runtime.
 */
export const rules = rulesTemplate.trim();

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
  const base =
    baseTemplate.replace("{sessionName}", sessionName).trim() + "\n\n" + rules;

  const layers = contextLayers.map((c) => c.trim()).filter((c) => c.length > 0);
  if (layers.length === 0) return base;

  return base + "\n\n" + layers.join("\n\n");
}

/**
 * The per-prompt reminder, re-injected by the UserPromptSubmit hook on every
 * turn after the first (see `bertrand contract --short`).
 *
 * It carries the *rules* rather than the loop mechanics, deliberately. The
 * mechanics — end on AUQ, multiSelect:true, a `Done for now` option — are hook
 * enforced, so a lapse is blocked whether or not the agent still remembers
 * them; repeating them buys nothing. The rules are soft guidance that nothing
 * catches, which makes them the half that actually decays as a long
 * conversation compacts the launch contract out of context. One line of
 * mechanics stays anyway: it is cheap, and it saves a blocked call and the
 * wasted turn that follows one.
 */
export function buildReminder(sessionName: string): string {
  return (
    `Reminder — you are in bertrand session ${sessionName}: end this turn with an ` +
    `AskUserQuestion call (multiSelect:true on every question, plus a "Done for now" option).\n\n` +
    rules
  );
}
