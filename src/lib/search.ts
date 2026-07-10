/**
 * Cross-session pointer search (docs/agent-cli.md, Spec 3).
 *
 * Answers "did we already discuss/decide X?" without knowing which session
 * holds it. Returns pointers — session, conversation ordinal, a snippet —
 * never payloads; the drill-in path is `bertrand log <session> --events
 * --conversation N`. Matching is AND-of-terms, case-insensitive, via SQL
 * LIKE over json_extract — at bertrand's scale (thousands of events per
 * project) this stays well under 10ms, so no FTS table until scale demands.
 *
 * Every function takes an explicit Db handle so `--all-projects` can sweep
 * sibling project databases via getDbForProject().
 */

import { and, eq, desc, like, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, sessions, categories, conversations } from "@/db/schema";

export const SEARCH_TYPES = [
  "prompt",
  "question",
  "answer",
  "assistant",
  "tool",
  "summary",
] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Types searched when --type is omitted. `tool` (commands, file paths) is
 *  high-noise, so it's opt-in. */
export const DEFAULT_SEARCH_TYPES: SearchType[] = [
  "prompt",
  "question",
  "answer",
  "assistant",
  "summary",
];

/** Event-backed search types: which event rows to scan, and where the
 *  searchable text lives inside meta. `answer` matches against the answers
 *  object's JSON text — keys (the questions) included, which is acceptable
 *  double-coverage rather than a precision problem. */
const EVENT_SOURCES: Record<
  Exclude<SearchType, "summary">,
  { event: string; jsonPath: string }
> = {
  prompt: { event: "user.prompt", jsonPath: "$.prompt" },
  question: { event: "session.waiting", jsonPath: "$.question" },
  answer: { event: "session.answered", jsonPath: "$.answers" },
  assistant: { event: "assistant.message", jsonPath: "$.text" },
  tool: { event: "tool.used", jsonPath: "$.detail" },
};

export type SearchHit = {
  project: string;
  session: string;
  status: string;
  /** 1-based conversation ordinal within the session; null for summary hits
   *  and legacy events that predate conversation tracking. */
  conversation: number | null;
  type: SearchType;
  at: string;
  snippet: string;
};

export type SearchOpts = {
  terms: string[];
  types?: SearchType[];
  /** Restrict to one session by "<category>/<slug>" name. */
  session?: string;
  limit?: number;
};

const SNIPPET_RADIUS = 80;
const DEFAULT_LIMIT = 20;

/** Escape LIKE wildcards in a user term; used with ESCAPE '\'. */
function likePattern(term: string): string {
  return "%" + term.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}

function likeClause(column: SQL, term: string): SQL {
  return sql`${like(sql`lower(${column})`, likePattern(term.toLowerCase()))} ESCAPE '\\'`;
}

/** ±SNIPPET_RADIUS chars around the first match, whitespace-collapsed. */
export function makeSnippet(text: string, firstTerm: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const idx = flat.toLowerCase().indexOf(firstTerm.toLowerCase());
  if (idx === -1) return flat.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(flat.length, idx + firstTerm.length + SNIPPET_RADIUS);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

type SessionInfo = { name: string; status: string };

/** id → "<categoryPath>/<slug>" + status, for hydrating hits. */
function loadSessionIndex(db: Db): Map<string, SessionInfo> {
  const rows = db
    .select({
      id: sessions.id,
      slug: sessions.slug,
      status: sessions.status,
      categoryPath: categories.path,
    })
    .from(sessions)
    .innerJoin(categories, eq(sessions.categoryId, categories.id))
    .all();
  return new Map(
    rows.map((r) => [r.id, { name: `${r.categoryPath}/${r.slug}`, status: r.status }]),
  );
}

/** conversation id → 1-based ordinal within its session (by startedAt). */
function loadConversationOrdinals(db: Db): Map<string, number> {
  const rows = db
    .select({
      id: conversations.id,
      sessionId: conversations.sessionId,
    })
    .from(conversations)
    .orderBy(conversations.startedAt, conversations.id)
    .all();
  const perSession = new Map<string, number>();
  const ordinals = new Map<string, number>();
  for (const row of rows) {
    const next = (perSession.get(row.sessionId) ?? 0) + 1;
    perSession.set(row.sessionId, next);
    ordinals.set(row.id, next);
  }
  return ordinals;
}

/**
 * Search one project's database. Hits come back newest-first, capped at
 * `limit` (default 20).
 */
export function searchProject(db: Db, projectSlug: string, opts: SearchOpts): SearchHit[] {
  const terms = opts.terms.filter((t) => t.length > 0);
  if (terms.length === 0) return [];
  const types = opts.types?.length ? opts.types : DEFAULT_SEARCH_TYPES;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const sessionIndex = loadSessionIndex(db);
  const ordinals = loadConversationOrdinals(db);

  let sessionFilter: string | undefined;
  if (opts.session) {
    const match = [...sessionIndex.entries()].find(([, info]) => info.name === opts.session);
    if (!match) return []; // unknown session in this project — no hits here
    sessionFilter = match[0];
  }

  const hits: SearchHit[] = [];

  for (const type of types) {
    if (type === "summary") {
      const conditions = [
        sql`${sessions.summary} IS NOT NULL`,
        ...terms.map((t) => likeClause(sql`${sessions.summary}`, t)),
      ];
      if (sessionFilter) conditions.push(eq(sessions.id, sessionFilter));
      const rows = db
        .select({ id: sessions.id, summary: sessions.summary, updatedAt: sessions.updatedAt })
        .from(sessions)
        .where(and(...conditions))
        .orderBy(desc(sessions.updatedAt))
        .limit(limit)
        .all();
      for (const row of rows) {
        const info = sessionIndex.get(row.id);
        if (!info) continue;
        hits.push({
          project: projectSlug,
          session: info.name,
          status: info.status,
          conversation: null,
          type,
          at: row.updatedAt,
          snippet: makeSnippet(row.summary ?? "", terms[0]!),
        });
      }
      continue;
    }

    const source = EVENT_SOURCES[type];
    const column = sql`json_extract(${events.meta}, ${source.jsonPath})`;
    const conditions = [
      eq(events.event, source.event),
      ...terms.map((t) => likeClause(column, t)),
    ];
    if (sessionFilter) conditions.push(eq(events.sessionId, sessionFilter));

    const rows = db
      .select({
        sessionId: events.sessionId,
        conversationId: events.conversationId,
        createdAt: events.createdAt,
        text: sql<string>`${column}`,
      })
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.createdAt))
      .limit(limit)
      .all();

    for (const row of rows) {
      const info = sessionIndex.get(row.sessionId);
      if (!info) continue;
      hits.push({
        project: projectSlug,
        session: info.name,
        status: info.status,
        conversation: row.conversationId ? (ordinals.get(row.conversationId) ?? null) : null,
        type,
        at: row.createdAt,
        snippet: makeSnippet(row.text ?? "", terms[0]!),
      });
    }
  }

  hits.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return hits.slice(0, limit);
}
