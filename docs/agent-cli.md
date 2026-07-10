# Agent-First CLI: Digest Log, Session Summaries, Search

**Status:** Design / proposed
**Date:** 2026-07-10
**Owner:** Adam

## Goal

Make bertrand sessions interconnected — opt-in, lightweight, precise. The CLI's
consumer is an agent ~98% of the time (the human surfaces are the TUI and the
dashboard), but the read commands are shaped for humans: `log` is an
all-or-nothing dump, sibling context carries no substance, and there is no way
to find prior work without already knowing which session holds it.

Target interaction model, cheapest-first:

```
sibling context (injected, ~free)          "what exists nearby, one line each"
  → bertrand search <term>     (~1-3KB)    "where was X discussed/decided?"
  → bertrand log <session>     (~1-2KB/convo)  digest: subject, decisions, outcome
  → bertrand log <s> --events  (filtered)  the timeline, trimmed meta
  → bertrand log <s> --full    (~100KB+)   everything; dashboard/debug only
```

## Audit findings (2026-07-10)

Measured against the live `bertrand` project DB (29 sessions):

- `log <session> --json` on three recent sessions: **157KB / 102KB / 64KB**
  (~40k / 25k / 16k tokens). Unusable in agent context.
- Payload anatomy of the 157KB session: `meta` is 89KB. Dominated by
  `tool.applied` carrying up to 4KB of written-file content per event
  (`meta.permissions[].newStr`, captured for dashboard diff rendering) and
  full assistant text (27KB, duplicated truncated in `summary`).
- The decision trail (every `user.prompt`, `session.waiting`,
  `session.answered`) of that session is **4.7KB — 3% of the payload**.
- `sessions.summary` is **NULL for every session**. `updateSession` supports
  it; nothing writes it. The Go version's Done-for-now recap was never ported.
  Sibling context therefore renders `- name: status (ago)` — no substance.
- Sibling context is scoped to the **same category only**
  (`src/contract/context.ts`); cross-category work in the same project is
  invisible.
- Redundancy in `log --json` events: `summary` duplicates `meta.prompt` /
  `meta.text` verbatim; `claude_id` appears twice per event; `label` /
  `category` are presentation concerns (and wrong for uncataloged types).
- Dead/drifted surface: `conversations[].eventCount` always 0
  (`updateConversationEventCount` never called); `tool.applied`,
  `session.blocked`, `session.active` missing from the event catalog (render
  as `unknown`/`lifecycle`); router `HOOK_COMMANDS` lists `assistant-message`
  which no longer exists; `log` no-args duplicates `list`; `stats`
  global/category variants duplicate `list` + `log` data.

---

## Spec 1 — Digest-first `log`

Three zoom levels. No schema change; everything derives from existing events.

### Level 0 (default): `bertrand log <session>`

Returns the digest as JSON (JSON becomes the default output; the ANSI
timeline renderer moves behind `--pretty` or is deleted — TUI/dashboard are
the human views):

```jsonc
{
  "project": { "slug": "bertrand", "name": "bertrand" },
  "session": {
    "name": "timeline/collect-better-llm-logs",
    "status": "paused",
    "summary": "…",              // from Spec 2
    "rating": 5,
    "worktreeBranch": null,
    "startedAt": "…", "updatedAt": "…"
  },
  "stats": { "durationS": 10388, "activePct": 22, "linesAdded": 1069,
             "linesRemoved": 378, "filesTouched": 16,
             "conversationCount": 1, "interactionCount": 14 },
  "conversations": [
    {
      "ordinal": 1,
      "id": "a9750fd5",                    // 8-char prefix; full id in --full
      "startedAt": "…", "endedAt": "…",
      "subject": "<first user.prompt, ≤200 chars>",
      "prompts": ["<each subsequent user.prompt, ≤200 chars>"],
      "decisions": [                        // the Q&A trail
        { "q": "<session.waiting question, ≤200>",
          "a": "<session.answered answers joined, ≤200>", "at": "…" }
      ],
      "filesTouched": ["dashboard/src/lib/timeline/segments.ts", "…"],
      "outcome": "<last assistant.message text, ≤300 chars>"
    }
  ],
  "hint": "bertrand log <s> --events [--conversation N] [--type …] for the timeline; --full for the complete record."
}
```

- `subject` / per-conversation grouping mirrors the dashboard's
  `segments.ts` logic — extract a shared helper rather than duplicating.
- `filesTouched`: distinct `meta.permissions[].detail` from `tool.applied`,
  repo-relative where possible.
- Budget: ~1–2KB per conversation; a 3-conversation session lands ≤6KB.

### Level 1: `bertrand log <session> --events`

Filtered, trimmed timeline. Flags compose:

- `--conversation <ordinal|id-prefix>`
- `--type <t,…>` — accepts raw event names and friendly groups:
  `qa` (waiting+answered), `prompt`, `assistant`, `tool` (used/work/applied),
  `lifecycle`
- `--since <ISO | 24h | 30m>`, `--limit <N>` (tail semantics)

Event shape (compact JSON, one array):

```jsonc
{ "event": "assistant.message", "at": "…", "conversation": 1,
  "summary": "<≤500 chars>",              // single text field; no meta duplication
  "files": ["…"]                          // tool.applied only; newStr/oldStr/edits dropped
}
```

Drop from agent output: `label`, `category`, colors, per-event `claude_id`
(conversation ordinal covers it), raw `meta`.

### Level 2: `bertrand log <session> --full`

Today's output verbatim (dashboard parity, debugging). The 100KB+ cost is
opt-in and labeled.

### Removals

- `log` no-args (use `list`).
- `stats` global/category variants; keep per-session `stats` or fold into the
  digest's `stats` block.

---

## Spec 2 — Session summaries + project-wide sibling context

### Constraint

After the user picks "Done for now", `on-answered.sh` emits
`{"continue": false}` — the agent never gets another turn. Any design that
asks the agent to summarize *after* the exit signal is dead on arrival.

### Write path: mechanical, at pause time (phase 1)

Design principles (carried from the Go rebuild): no LLM dependency, no manual
user steps. The agent's last message already leads with the outcome (harness
convention), so derive:

- **Where:** `update.ts` handling of `--event session.paused` (the terminal
  path of `on-done.sh`, which fires for both Done-for-now exits and
  nudge-cap exhaustion). Also on `claude.ended` / archive for non-Stop exits
  (ctrl-C, crash recovery).
- **What:** `sessions.summary = "<subject> → <outcome>"` where
  `subject` = first `user.prompt` of the session (≤120 chars),
  `outcome` = last `assistant.message` text (≤180 chars).
  Overwrite on every pause — latest state wins.
- Sessions that never got a prompt keep `summary = NULL` and render without
  the quote, as today.

### Optional override (phase 2, opt-in quality)

`bertrand summary "<one line>"` sets `sessions.summary` explicitly; a
contract line invites the agent to call it at milestones. Mechanical baseline
still covers the forgot-to-call case. Ship only if phase 1 summaries prove
too noisy.

### Sibling context: category → project

`buildSiblingContext` changes:

- Scope: all **non-archived** sessions in the active project (not just the
  category), grouped by category, most-recently-updated first.
- Cap ~12 lines; overflow becomes `+N more — bertrand list`.
- Archived siblings are dropped from injection (discoverable via
  `list --all` / `search`).
- Line format unchanged: `- <name>: <status> [worktree: b] — "<summary>" (<ago>)`
  — now with summaries actually populated.
- Guidance text rewritten for the digest-first flow (see Spec 1 hint), and the
  same rewrite lands in `COMMAND_REFERENCE` (`src/cli/help.ts`) — the injected
  help is the agent's mental model; today it actively recommends the 40k-token
  dump ("Full record… complete event timeline").

Cost: ~8 live/paused sessions ≈ a few hundred tokens injected once per
conversation.

---

## Spec 3 — `bertrand search`

The missing primitive: answer "did we already discuss/decide X?" without
knowing which session to open. Returns **pointers, not payloads**.

### Surface

```
bertrand search <term…> [--project <slug> | --all-projects]
                        [--type prompt,question,answer,assistant,summary,tool]
                        [--session <name>] [--limit N]
```

- Terms AND-ed, case-insensitive substring match.
- Default types: everything except `tool` (command lines / file paths are
  noisy; opt-in via `--type tool`).
- Default `--limit 20`.

### Match targets

| type      | source                                        |
|-----------|-----------------------------------------------|
| summary   | `sessions.summary`                            |
| prompt    | `user.prompt` → `meta.prompt`                 |
| question  | `session.waiting` → `meta.question`           |
| answer    | `session.answered` → `meta.answers` values    |
| assistant | `assistant.message` → `meta.text`             |
| tool      | `tool.used` → `meta.detail` (opt-in)          |

### Implementation

SQL `LIKE` over `json_extract(meta, …)` per type, per project DB. At current
scale (thousands of events per project) this is <10ms — no FTS5 table, no
migration. `--all-projects` iterates the project registry the same way the
dashboard server's multi-project merge does. Revisit FTS5 only if scale
demands it.

### Output (JSON, default)

```jsonc
[
  { "project": "bertrand",
    "session": "sessions/compartmentalize-sibling-sessions",
    "status": "paused",
    "conversation": 2,
    "type": "answer",
    "at": "2026-07-08 18:07:31",
    "snippet": "…±80 chars around the first match…" }
]
```

~150 bytes/hit; a full page of 20 hits ≈ 3KB. Drill-in path:
`bertrand log <session> --events --conversation 2`.

---

## Hygiene (bundle with the first PR)

- Catalog entries for `tool.applied`, `session.blocked`, `session.active`.
- Wire `updateConversationEventCount` or drop the column from output (it
  currently reports 0 — lying data).
- Remove `assistant-message` from router `HOOK_COMMANDS`.

## Rollout

1. **PR 1:** hygiene + digest-first `log` (+ shared conversation-segmentation
   helper extracted from `dashboard/src/lib/timeline/segments.ts`).
2. **PR 2:** summary write path + project-wide sibling context + help-text
   rewrite (depends on nothing in PR 1, but the help rewrite reads best once
   the digest exists).
3. **PR 3:** `bertrand search`.

Token budget, before → after: consulting one sibling session cost ~25–40k
tokens (or was skipped); after, awareness is injected for ~hundreds, a search
is ~200 tokens, and a digest is ~500 — with the firehose still available
behind `--full`.
