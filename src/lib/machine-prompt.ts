/**
 * Prompts claude submits on its own behalf through the user.prompt channel — a
 * background task finishing (`<task-notification>`), a subagent handing back
 * (`<agent-message from="…">`), hook injections. They are what happened, not
 * what the user asked, so neither a session's name (lib/derive-slug.ts) nor
 * its summary (lib/summary.ts) may be built from them. One definition, so the
 * two can't disagree about what counts.
 *
 * Any lowercase opening tag, attributes allowed: the attribute form is real
 * (`agent-message` carries `from`), and a tag-name allowlist would miss the
 * next kind claude adds.
 */
const MACHINE_PROMPT = /^<[a-z][a-z-]*(\s[^>]*)?>/;

export function isMachinePrompt(text: string): boolean {
  return MACHINE_PROMPT.test(text.trimStart());
}
