/**
 * Pause-time session slug derivation (ELKY-168, docs/orca-boundary.md §4c).
 *
 * Turns a session's own conversation into its name: lowercase kebab-case,
 * 2–5 meaningful tokens, LLM-free and zero-user-steps. The corpus analysis
 * behind this (§4c) says ~45% of sessions derive cleanly, ~32% partially,
 * ~24% need a fallback — the bar is "no worse than the human name", not
 * perfection, so the algorithm is deliberately mechanical:
 *
 *  - the first substantive prompt anchors the slug (its token *order* is
 *    kept, so "fix the merge conflicts" stays verb-object: fix-merge-…);
 *  - ALL prompts vote on which anchor tokens survive the 5-token cap and
 *    supply extras when the anchor is thin — intent often only appears
 *    after an opening pointer prompt;
 *  - assistant messages count at half weight, a tiebreaker not a source;
 *  - slash-command openings (/agent-skills:…) carry no subject and are
 *    skipped (§4c failure class 2);
 *  - GitHub URLs classify through the shared entity parser (ELKY-169):
 *    pull/issue links collapse to pr-N / issue-N tokens, every other URL
 *    vanishes — the number is often the best identifier a prompt contains;
 *  - a ticket id in the session's git branch (elky-167, UI-132) leads the
 *    slug when the prompts themselves carry no identifier.
 */

import { getDb, type Db } from "@/db/client";
import { getEventsByType } from "@/db/queries/events";
import { getSession, isSlugTakenByOtherSession } from "@/db/queries/sessions";
import { parseGithubUrl } from "@/lib/github/web-url";

/** Must match SEGMENT_PATTERN in parse-session-name.ts. */
const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

const MAX_TOKENS = 5;
/** When the anchor prompt is thinner than this, borrow from later prompts. */
const MIN_TOKENS = 2;
/** Supplementation stops here — a borrowed tail shouldn't dominate. */
const SUPPLEMENT_TARGET = 3;
const MAX_SLUG_CHARS = 48;
/** Longer single tokens are hashes/ids/pasted junk, not words. */
const MAX_TOKEN_CHARS = 24;

/**
 * Words that carry no naming signal: articles, pronouns, auxiliaries, and the
 * conversational filler that opens prompts ("please have a thorough look
 * at…"). Generic verbs like "make"/"get" are here; specific ones ("fix",
 * "refactor", "migrate") are exactly what a verb-object slug wants kept.
 */
const STOPWORDS = new Set([
  "a", "about", "above", "actually", "after", "again", "against", "all",
  "already", "also", "am", "an", "and", "any", "anything", "are", "arent",
  "as", "at", "back", "be", "because", "been", "before", "being", "below",
  "between", "bit", "both", "but", "by", "can", "cannot", "cant", "could",
  "couldnt", "did", "didnt", "do", "does", "doesnt", "doing", "done", "dont",
  "down", "during", "each", "either", "else", "etc", "even", "ever", "every",
  "few", "first", "for", "from", "further", "get", "gets", "getting", "give",
  "go", "going", "gonna", "good", "got", "great", "had", "has", "hasnt",
  "have", "havent", "having", "he", "hello", "help", "her", "here", "hers",
  "hey", "hi", "him", "his", "how", "i", "if", "im", "in", "instead", "into",
  "is", "isnt", "it", "its", "just", "kind", "know", "let", "lets", "like",
  "likes", "little", "look", "looking", "looks", "lot", "make", "makes",
  "making", "many", "may", "maybe", "me", "mean", "might", "more", "most",
  "much", "must", "my", "myself", "need", "needed", "needs", "new", "no",
  "nor", "not", "now", "of", "off", "ok", "okay", "on", "once", "one",
  "only", "onto", "or", "other", "our", "ours", "out", "over", "own",
  "please", "pretty", "put", "quite", "rather", "really", "recently",
  "right", "same", "see", "seem", "seems", "she", "should", "shouldnt",
  "so", "some", "something", "still", "stuff", "such", "sure", "take",
  "than", "thank", "thanks", "that", "thats", "the", "their", "theirs",
  "them", "then", "there", "these", "they", "thing", "things", "think",
  "this", "thorough", "thoroughly", "those", "through", "to", "too", "try",
  "trying", "under", "until", "up", "upon", "us", "use", "used", "using",
  "very", "want", "wanted", "wants", "was", "wasnt", "way", "we", "well",
  "went", "were", "what", "whats", "when", "where", "whether", "which",
  "while", "who", "whom", "why", "will", "with", "wont", "would",
  "wouldnt", "yeah", "yes", "yet", "you", "your", "yours",
  // Launch-template boilerplate — the user's standing prompt shape is
  // "have a look at <ref>, ask clarifying questions if anything is unclear,
  // otherwise get started", and none of it names the session. Bare "pr" /
  // "issue" are here too; the numbered pr-N / issue-N forms merge before
  // stopword filtering and are the ones worth keeping.
  "anything", "ask", "asked", "asking", "begin", "check", "checks",
  "clarifying", "enough", "id", "if", "important", "issue", "issues",
  "otherwise", "part", "pr", "previous", "proceed", "question", "questions",
  "start", "started", "starting", "unclear", "via", "work",
  // Contractions land here apostrophe-less (tokenize collapses "i've"→"ive").
  "heres", "hes", "ive", "shes", "theres", "theyre", "theyve", "weve",
  "whos", "youre", "youve",
]);

/**
 * Tokens a URL contributes in place of itself. GitHub URLs classify through
 * the shared entity parser (web-url.ts) rather than a second URL grammar
 * here: only pull/issue links name anything, and only when the ref number is
 * a real number (trailing punctuation rides along in `\S+` matches). Linear
 * issue URLs carry the best signal a pointer prompt has — the ticket id and
 * the human-written title slug (§4c failure class 1). Every other URL is
 * noise and contributes nothing.
 */
function urlTokens(url: string): string {
  const ref = parseGithubUrl(url.startsWith("www.") ? `https://${url}` : url);
  if (ref?.kind === "pr" || ref?.kind === "issue") {
    const number = /^\d+/.exec(ref.number)?.[0];
    return number ? `${ref.kind}-${number}` : "";
  }
  const linear = /\bissue\/([a-z]+-\d+)(?:\/([a-z0-9-]+))?/.exec(url);
  if (linear) {
    return `${linear[1]} ${linear[2] ? linear[2].replace(/-/g, " ") : ""}`;
  }
  return "";
}

/**
 * Extract naming tokens from one text. Code fences vanish (pasted code is
 * never a name), URLs are swapped for whatever their entity is worth
 * (urlTokens) so the identifier survives its own URL being deleted, and bare
 * host-less refs — "PR 152", "pull/220", "issue/elky-150" — merge to the
 * same token shapes.
 */
function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+|\bwww\.\S+/g, (url) => ` ${urlTokens(url)} `)
    .replace(/\b(?:pull|pulls)\/(\d+)/g, " pr-$1 ")
    .replace(/\bissues?\/(\d+)/g, " issue-$1 ")
    .replace(
      /\bissue\/([a-z]+-\d+)(?:\/([a-z0-9-]+))?/g,
      (_, id: string, title?: string) =>
        ` ${id} ${title ? title.replace(/-/g, " ") : ""} `,
    )
    // "don't" → "dont" so contractions hit the stopword list, not "don"+"t".
    .replace(/([a-z])'([a-z])/g, "$1$2");

  const raw = cleaned
    .split(/[^a-z0-9._-]+/)
    .map((t) => t.replace(/^[._-]+|[._-]+$/g, ""))
    .filter(Boolean);

  const tokens: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const word = raw[i]!;
    const next = raw[i + 1];
    if ((word === "pr" || word === "pull" || word === "issue") && next && /^\d+$/.test(next)) {
      tokens.push(`${word === "pull" ? "pr" : word}-${next}`);
      i++;
      continue;
    }
    if (word.length < 2 || word.length > MAX_TOKEN_CHARS) continue;
    if (/^\d+$/.test(word)) continue;
    if (STOPWORDS.has(word)) continue;
    if (!SEGMENT_PATTERN.test(word)) continue;
    tokens.push(word);
  }
  return tokens;
}

/**
 * A slash-command opening (/agent-skills:test-driven-development) names a
 * workflow, not a subject. Drop the command token; whatever arguments follow
 * it are real text and stay.
 */
function stripSlashCommand(prompt: string): string {
  const trimmed = prompt.trimStart();
  if (!trimmed.startsWith("/")) return prompt;
  return trimmed.replace(/^\/\S+/, "");
}

/**
 * Prompts that open with an XML-ish wrapper tag (<task-notification>, hook
 * injections) are machine text recorded through the user.prompt channel, not
 * the user speaking — they must not vote on the session's name.
 */
function isMachinePrompt(prompt: string): boolean {
  return /^<[a-z][a-z-]*>/.test(prompt.trimStart());
}

/** Ticket-shaped token: elky-167, UI-132 — and pr-220 / issue-38 fit too. */
const IDENTIFIER_PATTERN = /^[a-z]{2,10}-\d+$/;
/** First ticket-shaped run in a branch name (adamfratino/UI-132-fix-thing). */
const BRANCH_TICKET_PATTERN = /\b[A-Za-z]{2,10}-\d+\b/;

/**
 * Pure core: conversation texts in, slug out. Null when no prompt yields a
 * single meaningful token — a garbage name is worse than no name; a branch
 * ticket alone never invents one.
 */
export function deriveSlugFromTexts(
  prompts: string[],
  assistantTexts: string[] = [],
  opts: { branch?: string | null } = {},
): string | null {
  const promptTokens = prompts.map((p) =>
    isMachinePrompt(p) ? [] : tokenize(stripSlashCommand(p)),
  );

  // Every prompt votes double, assistant narration single — the user's own
  // words say what the session is *about*; the agent's say what it did.
  const freq = new Map<string, number>();
  const bump = (token: string, weight: number) =>
    freq.set(token, (freq.get(token) ?? 0) + weight);
  for (const tokens of promptTokens) for (const t of tokens) bump(t, 2);
  for (const text of assistantTexts) for (const t of tokenize(text)) bump(t, 1);

  const anchorIndex = promptTokens.findIndex((tokens) => tokens.length > 0);
  if (anchorIndex === -1) return null;

  let candidates = [...new Set(promptTokens[anchorIndex]!)];

  if (candidates.length > MAX_TOKENS) {
    // Keep the tokens the rest of the conversation kept talking about, but
    // re-emit them in anchor order so the verb-object shape survives.
    const position = new Map(candidates.map((t, i) => [t, i]));
    candidates = candidates
      .toSorted(
        (a, b) =>
          (freq.get(b) ?? 0) - (freq.get(a) ?? 0) ||
          position.get(a)! - position.get(b)!,
      )
      .slice(0, MAX_TOKENS)
      .toSorted((a, b) => position.get(a)! - position.get(b)!);
  }

  if (candidates.length < MIN_TOKENS) {
    const chosen = new Set(candidates);
    const pool: string[] = [];
    for (const tokens of promptTokens.slice(anchorIndex + 1)) {
      for (const t of tokens) {
        if (!chosen.has(t) && !pool.includes(t)) pool.push(t);
      }
    }
    pool.sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0));
    for (const t of pool) {
      if (candidates.length >= SUPPLEMENT_TARGET) break;
      candidates.push(t);
    }
  }

  // A ticket id in the branch name is real signal, but the conversation's own
  // identifiers outrank it (ELKY-169): only lead with the branch ticket when
  // no prompt mentioned any ticket/PR/issue identifier at all.
  const branchTicket = opts.branch
    ?.match(BRANCH_TICKET_PATTERN)?.[0]
    .toLowerCase();
  if (
    branchTicket &&
    !promptTokens.some((tokens) => tokens.some((t) => IDENTIFIER_PATTERN.test(t)))
  ) {
    candidates = [branchTicket, ...candidates].slice(0, MAX_TOKENS);
  }

  const kept: string[] = [];
  let length = 0;
  for (const token of candidates) {
    const next = length === 0 ? token.length : length + 1 + token.length;
    if (kept.length > 0 && next > MAX_SLUG_CHARS) break;
    kept.push(token);
    length = next;
  }

  const slug = kept.join("-");
  return SEGMENT_PATTERN.test(slug) ? slug : null;
}

/**
 * Derive a slug from a session's recorded events, consulting the session's
 * git branch for a ticket id the prompts didn't mention. Null when the
 * session has nothing derivable — callers keep the existing name rather than
 * inventing one.
 */
export function deriveSessionSlug(
  sessionId: string,
  db: Db = getDb(),
): string | null {
  const prompts = getEventsByType(sessionId, "user.prompt", db)
    .map((row) => metaStr(row.meta, "prompt"))
    .filter(Boolean);
  const messages = getEventsByType(sessionId, "assistant.message", db)
    .map((row) => metaStr(row.meta, "text"))
    .filter(Boolean);
  const branch = getSession(sessionId, db)?.branch ?? null;
  return deriveSlugFromTexts(prompts, messages, { branch });
}

function metaStr(meta: Record<string, unknown> | null, key: string): string {
  const value = meta?.[key];
  return typeof value === "string" ? value : "";
}

/**
 * Collision rule (decided in ELKY-167): automatic derivation must never take
 * over another session's identity. If any *other* session in the project DB
 * holds the slug — any category — walk -2, -3, … until free. A session
 * re-deriving its own current slug (or suffix) is not a collision, so
 * repeated pauses are stable instead of racking up suffixes.
 */
export function resolveSlugCollision(
  slug: string,
  sessionId: string,
  db: Db = getDb(),
): string {
  if (!isSlugTakenByOtherSession(slug, sessionId, db)) return slug;
  for (let n = 2; ; n++) {
    const candidate = `${slug}-${n}`;
    if (!isSlugTakenByOtherSession(candidate, sessionId, db)) return candidate;
  }
}
