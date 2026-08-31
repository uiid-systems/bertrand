# ELKY-173 — Session identity from the hook payload

Written 2026-08-30 on branch `elky-173`, measured against the personal laptop's
`~/.claude/projects` (101 transcripts, 22 distinct cwds) and every project DB in
`~/.bertrand/projects`. Every number here is reproducible — Appendix A gives the
command.

**Scope.** This decides the identity rules for **Phase 2** of the launcher-optional
workstream: implicit auto-create on an unseen `session_id` (ELKY-175). Phase 1
(ELKY-179 — explicit `/bertrand` adoption) is the prerequisite and answers the same
questions by keeping a human in the loop. This doc is what those answers have to
become when nobody is present.

**What it does not decide:** whether Phase 2 ships. That stays with ELKY-175, after
adopted sessions have run in practice.

---

## Thesis: the marker is the identity index

`~/.bertrand/run/adopted-<claude_session_id>` maps a claude session id onto a
bertrand session id **and a project slug**. Phase 1 has `bertrand adopt` write it;
Phase 2 has a hook write it. Everything downstream — the six guards, event capture,
contract delivery, status flips, finalize — is identical either way.

So Phase 2 is not a rewrite of Phase 1. It is **one new writer, plus a policy for
when that writer may fire.** Each question below is a question about who may write a
marker, what it must contain, and when it may be removed.

---

## Measured baseline (2026-08-30, personal laptop)

| Measurement | Value |
|---|---|
| Claude transcripts on disk | 101 across 22 cwds |
| Transcripts whose filename ≠ their own `sessionId` | **0 / 101** |
| Transcripts containing more than one `sessionId` | **0 / 101** |
| cwds that are Orca workspaces (outside every registered `repo.path`) | **13 / 22** |
| Transcripts resolving to a registered project **by git origin** | **101 / 101** |
| Transcripts resolving to a registered project **by path prefix** | 87 / 101 |
| `conversations` rows in the `bertrand` project DB | 56 |
| Transcripts in bertrand's cwds with **no** conversation row | **22 / 64 (34%)** |
| Conversation rows with a same-named transcript on disk | 42 / 56 |
| Conversations ever re-entered (`claude.started` > 1) | **0 / 56** |
| Sessions that ever got a second conversation | 3 / 53 |
| Sessions with `pid IS NULL` | 53 / 53 |
| Sessions with `name_source = 'manual'` | 53 / 53 |

Two of these carry most of the design:

- **13 of 22 cwds are Orca workspaces.** Resolving a project by matching the cwd
  against a registered `repo.path` fails for every one of them — and they are the
  new normal, not the exception.
- **34% of claude work in bertrand's own directories is invisible to bertrand.**
  That is the upside of this workstream, and — see [Drift](#drift-the-required-position) —
  also its risk, because it is the same 22 sessions either way.

---

## Q1 · Dedupe: env vs payload

### The ladder

1. **`BERTRAND_SESSION` (env).** Bertrand launched this claude. Always wins; the
   hook never consults a marker when it is set (`sessionGuard`,
   `src/hooks/scripts.ts` — one shared guard, emitted into all six scripts).
2. **`adopted-<session_id>` marker.** Someone adopted this claude. Read the bertrand
   session id and project slug out of it.
3. **Auto-create** (Phase 2 only, and only through the gates in
   [Drift](#drift-the-required-position)).

### Why two rows for one conversation is already impossible

`conversations.id` **is** the claude session id and it is the primary key
(`src/db/schema.ts:109`). Within a project DB, a duplicate insert throws. Dedupe is
not something the ladder has to achieve — the schema already achieves it.

What the schema cannot see is **the same conversation in two different project
DBs**. Each project is its own SQLite file (`src/db/client.ts:43`), so a
conversation created under project `bertrand` and later resolved under project
`design-system` produces two sessions, no constraint violated, no error printed.

**Therefore dedupe reduces to project resolution.** Q1 is downstream of Q4.

### Rules

- **R1** — Env wins. A hook with `BERTRAND_SESSION` set never reads a marker.
- **R2** — `adopt` (and any auto-create path) refuses to run under `BERTRAND_SESSION`.
- **R3** — Creation races resolve toward the existing row. `createConversation`
  (`src/db/queries/conversations.ts:5`) failing on the PK means another writer won;
  re-read and continue rather than erroring. Two hooks can fire concurrently on the
  first turn of a conversation.
- **R4** — Marker writes are write-then-rename, matching `writeRegistry`
  (`src/lib/projects/registry.ts`). A half-written marker parses as a valid but wrong
  session id, which is worse than no marker.

---

## Q2 · `--resume` handling

### What the corpus says

- A transcript never mixes ids (0/101 files carry more than one `sessionId`), so a
  resumed conversation is not a new file appended under a new id — the id is stable
  for the file's whole life.
- Bertrand's own resume path already depends on this: `planResume` passes
  `--resume <conversationId>` and keeps keying events off that same id
  (`src/engine/resume-plan.ts:73,107`), and 42/56 conversation rows have a
  same-named transcript on disk.
- **Resume is rare.** 0 of 56 conversations were ever re-entered; 3 of 53 sessions
  ever got a second conversation. Resuming a *session* in bertrand mints a *new*
  conversation by default (`newConversation`, `src/engine/resume-plan.ts:47`), so
  even the resume path mostly produces unseen ids.

### Rule: "unseen" has exactly one definition

> A `session_id` is **unseen** iff there is no `adopted-` marker for it **and**
> `getConversation(session_id)` misses in the resolved project DB.

Resume is then not a special case at all. A resumed conversation has a row, so it is
seen, so it resolves instead of creating. The marker is a cache; the conversations
row is the truth.

### Consequences

- **Marker pruning is cache eviction, never a state change.** A swept marker for a
  live conversation must be re-derivable from the DB on the next tick. This forbids
  putting anything in the marker that is not also in the database.
- **A resumed conversation in a different cwd keeps its original project.** The DB
  lookup wins; cwd is consulted only when the id is unseen everywhere. Otherwise
  `cd`-ing into a worktree and resuming would fork the session into a second project.
- **The unseen path may search every project DB.** That is 6 files on this machine
  and one indexed PK lookup each, and by definition it happens at most once per
  conversation — every later tick hits the marker. Search order: marker → active
  project → every registered project.
- **`bertrand`'s "+ New conversation" on an adopted session is legal**, because it
  re-launches claude with `--session-id <fresh uuid>` and hands the session back to
  the launched path. That is the intended resume semantics for adopted sessions, and
  it needs no new code.

---

## Q3 · `claude_id` vs `session_id`

Today they are the same value because **bertrand mints it**: it generates the UUID
and passes `--session-id $claudeId` (`src/engine/process.ts:35-40`).

If bertrand stops launching, the id becomes **claude's**, and identity holds only if
we keep writing it as the conversation's primary key. `createConversation` already
accepts a caller-supplied id, so this costs nothing — but it must be stated as an
invariant, because the alternative (mint our own, store claude's alongside) silently
breaks four things:

| Depends on `conversations.id == payload session_id` | Where |
|---|---|
| Event → conversation FK resolution (`meta.claude_id` → row lookup) | `src/cli/commands/update.ts:172-178` |
| `events.conversation_id` foreign key | `src/db/schema.ts:141` |
| Transcript location on the resume path | `src/lib/transcript.ts:106,148` → `src/engine/resume-plan.ts:107` |
| The `contract-sent-<cid>` marker key | `src/hooks/scripts.ts:264` |

**Invariant:** bertrand never mints a conversation id for a claude it did not
launch. `newConversation()`'s `randomUUID()` is valid *only* on the launched path,
where bertrand hands the id to claude rather than the reverse.

**Transcript filenames are a separate identity and must stay separate.** All 101
files here are named for their own `sessionId`, but Claude Code does not guarantee
it — `findClaudeTranscript` (`src/lib/transcript.ts:106`) already falls back to
scanning and matching each file's internal `sessionId`. Nothing in this design may
re-derive a transcript path from an id without going through that function.

---

## Q4 · Project resolution from a cwd

This is the hard question, and the corpus answers it.

### Path-prefix matching is not viable

13 of 22 cwds are Orca workspaces under `/Users/adamfratino/orca/workspaces/…` —
git worktrees whose path is beneath no registered `repo.path`. Prefix matching
misses every one (14/101 transcripts, and effectively every session since the Orca
migration).

### Git origin resolution works, and already handles worktrees

`resolveRepoAt` (`src/lib/github/resolve.ts`) normalizes a linked worktree to its
**main checkout** — its `ResolvedRepo.path` doc comment states this explicitly — so
this very session's cwd resolves to `/Users/adamfratino/www/uiid/bertrand`, origin
`uiid-systems/bertrand`, and `findProjectByRepo` (`src/lib/projects/policy.ts:63`)
returns project `bertrand`. Measured: **101/101 transcripts resolve this way.**

### Resolve once, persist, export

`resolveRepoAt` spawns `git` twice and caches **in-process**, which is worthless to
one-shot hook subprocesses. So:

- Resolve the project **once**, at marker-write time.
- Persist the slug **in the marker**.
- Every later hook tick reads the marker (one `[ -f ]` and a `cut`) and **exports
  `BERTRAND_PROJECT`** before calling `bq update`.

That last step is load-bearing and easy to miss. `bertrand update` has no
`--project` flag; `getDb()` resolves through `resolveActiveProject()`
(`src/db/client.ts:43` → `src/lib/projects/resolve.ts:33`), whose order is
`BERTRAND_PROJECT` → `activeProjectSlug` in `projects.json` → the literal
`"default"`. Without the export, an adopted session writes into **whatever project
the user last ran `bertrand project use` on** — a silent cross-project write that
produces no error and no visible symptom until someone goes looking for a session in
the wrong log. The launched path already avoids this by pinning
`BERTRAND_PROJECT` at spawn (`src/engine/process.ts:58`,
`src/engine/dashboard-session.ts:165`); adopted sessions need the same pin, delivered
through the marker instead of the environment.

### A cwd belonging to no project

Three options, and they get different answers depending on who asked:

| Case | Behavior |
|---|---|
| Explicit `bertrand adopt`, unresolvable cwd | Land in `default`. A human asked; refusing is worse than a slightly wrong bucket, and `--project <slug>` overrides. |
| Phase 2 auto-create, unresolvable cwd | **Refuse.** Write no marker; the hooks stay a total no-op. Silence is the correct behavior for a directory nobody registered. |
| Either, no project could be invented | Never auto-create a *project*. Projects are bound to GitHub repos by policy (`UnboundProjectError`, `src/lib/projects/policy.ts`), and fabricating registry state from a cwd is not a thing a hook may do. |

This keeps the standing rule that **bertrand must not require git**: a session in a
non-repo directory still works — you adopt it explicitly and it lands in `default`.
What requires git is *automatic* project inference, which is a different promise.

**Do not read `ORCA_WORKTREE_ID`.** It carries the workspace path and would shortcut
this entire section, at the cost of binding bertrand to one host. The boundary doc's
decision #4 (do not bind bertrand to Orca) governs; `git` is the host-agnostic
channel and it is sufficient.

---

## Migration path: sessions created the old way

**Nothing changes for existing rows, and no backfill is needed.** Identity for old
sessions already lives in `conversations.id`, which is already the claude session
id — so every historical conversation is *already* payload-addressable. A hook that
sees `session_id` X finds conversation X and resolves to its session, whether that
row was written in June or today.

Four specifics:

1. **Naming.** All 53 sessions in the `bertrand` DB carry `name_source = 'manual'`,
   and pause-time derivation only ever renames `derived` rows. Old sessions will
   never be silently renamed by anything in this design. New payload-created rows
   use `createSession({ slug, nameSource: "derived" })` with no name
   (`src/db/queries/sessions.ts:50`, which throws if a derived row carries its own
   display name).
2. **`pid` must be real.** `shouldIgnoreStatusFlip` (`src/cli/commands/update.ts:33`)
   refuses `active`/`waiting`/`blocked` flips whenever `session.pid === null`, which
   is the state of every row bertrand did not launch (53/53 here). Record
   `CLAUDE_PID` as the session pid — the precedent is `dashboard-session.ts:238`,
   which records the PTY's pid rather than the server's. With a real pid,
   `recoverStaleSessions` (`src/engine/recovery.ts:39`) finalizes adopted sessions
   for free when claude exits, and the "stuck active forever" risk disappears
   without new lifecycle code.
3. **`pidStartedAt` must not be `Date.now()`.** `verifyPidIdentity`
   (`src/lib/process-identity.ts:80-103`) compares the recorded timestamp against
   `Date.now() - parseEtimeMs(ps etime)` with a 120 s tolerance. Adopting a claude
   that has been running longer than that records a timestamp its own identity check
   rejects, and `recoverStaleSessions` then finalizes a live session. Derive it the
   way the checker does — from `ps -o etime=` — so the two agree by construction.
   (Launch never hits this because it records pid and timestamp together at spawn.)
4. **Marker pruning needs a second prefix and a different rule.**
   `pruneStaleContractMarkers` is hardcoded to `contract-sent-`
   (`src/hooks/runtime.ts:23,63`) and sweeps on a 24-hour mtime. `adopted-*` markers
   must **not** inherit that rule — an adopted conversation can be resumed weeks
   later. Sweep them on *state* instead (conversation row gone, or session archived),
   or don't sweep at all and let Q2's "marker is a cache" property rebuild them.

---

## Drift: the required position

The acceptance criterion asks for an explicit position on the risk that removing the
TUI as the entry point removes its implicit curation gate. Here it is.

**The gate is real, but it is already thinner than the original framing assumed.**
Derived naming (ELKY-167–172) removed the typed name, so what remains of the gate is
only the decision to start a session at all.

**The upside and the downside are the same number.** 22 of 64 transcripts in
bertrand's own directories have no conversation row. That 34% is exactly the work
bertrand currently misses — and exactly the 22 extra sessions auto-create would have
produced, most of them short, some of them one prompt long.

**Position: Phase 2 must not auto-create on every unseen id.** Gate it, cheapest
first:

1. **Opt in per project**, not globally. A flag in `projects.json`; a user who wants
   everything recorded says so once, for the repo where it makes sense.
2. **Require materiality before creating.** `SessionStart` is the natural *detection*
   point but the wrong *creation* point — it fires before the conversation has done
   anything. Create on the first signal that something happened worth keeping (first
   `tool.applied`, or the second user prompt), which costs nothing because
   `ingestTranscript` is cursor-based and idempotent and will back-fill the earlier
   turns at creation time.
3. **Auto-archive triviality at pause** — a session with no file edits and fewer than
   N events is archived rather than listed. This is cleanup, not a gate; add it once
   the corpus shows the shape.

Ship 1 + 2 in the first cut.

**And the fallback, stated plainly:** if those gates feel like too much machinery,
do not ship Phase 2. Keep `/bertrand`. Explicit adoption *is* the curation gate, it
costs one slash command, and it captures the same 34% for any session the user
actually cares about.

---

## Open, and deliberately not answered here

- **Child and subagent sessions are unmeasured.** This machine has 0 transcripts
  containing `isSidechain: true`, yet the session this doc was written in carries
  `CLAUDE_CODE_CHILD_SESSION=1`. Before Phase 2, confirm whether a subagent gets its
  own `session_id` and its own hook events. If it does, gates 1 and 2 are not enough
  and this doc needs a sixth rule — auto-create would otherwise mint a bertrand
  session per Task call.
- **Whether to hook `SessionStart`** (ELKY-175's own question). This doc constrains
  it only to being a detection point, not a creation point.
- **Preferences** (ELKY-179 Phase 3). Nothing here creates a place to hang them.

---

---

## Closed since: the greedy-match caveat (ELKY-174, 2026-08-31)

The ELKY-179 spike left one question open — extraction takes the *first*
`"session_id"` in the payload, so does any event type nest a second one? Measured
against six concurrent claude sessions on the personal laptop:

- **`session_id` is the payload's first field.** Key order, identical in every
  capture: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`,
  `effort`, `hook_event_name`, `tool_name`, `tool_input`, `tool_response`,
  `tool_use_id`, `duration_ms`.
- **A nested occurrence cannot collide.** Payload strings arrive escaped, so a
  `tool_input` carrying the literal text `{"session_id":"…"}` — this repo's own hook
  tests do — appears as `\"session_id\":\"` and never matches the unescaped
  pattern. Verified by firing a hook with a decoy id in `tool_input.command`.
- **`CLAUDE_CODE_SESSION_ID` is absent from claude's own process env**, so Claude
  injects it per hook spawn. It matched the payload in 6/6 sessions. It is
  undocumented where `session_id` is published, so `sessionGuard` reads the payload
  and keeps the env var only as the fallback for a payload it cannot parse.

The guard reads a bounded 512-byte head with the `read` builtin rather than
`$(cat)`. Measured as paired per-invocation runs of the rendered scripts, 200
pairs per cell, against the env-var-only guard it replaced:

| Path | 3 KB payload | 120 KB payload |
|---|---|---|
| No-op (no marker — every unadopted claude) | +0.17 ms/hook | +0.21 ms/hook |
| Resolved (adopted session) | +0.10 ms/hook | +0.11 ms/hook (within noise) |

The number to look at is the second column, not the first: the cost is **flat in
payload size**, where the obvious implementation — `input="$(cat)"` piped through
`grep`, the one the issue's no-new-`jq` constraint is really aimed at — costs
**+7.7 ms** on a 120 KB Edit payload and grows with it. That is paid on a path
every claude on the machine takes and almost none of them are ours.

---

## Appendix A — reproduce the numbers

```bash
# Transcript count, filename-vs-sessionId agreement, multi-id files
cd ~/.claude/projects
for f in ./*/*.jsonl; do
  b="${f##*/}"; b="${b%.jsonl}"
  id=$(head -3 "$f" | grep -o '"sessionId":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ "$id" = "$b" ] || echo "MISMATCH $f"
  n=$(grep -o '"sessionId":"[^"]*"' "$f" | sort -u | wc -l)
  [ "$n" -gt 1 ] && echo "MULTI($n) $f"
done

# Distinct cwds, and transcripts per cwd
for d in ./*/; do printf '%3d  %s\n' "$(ls -1 "$d" | grep -c '\.jsonl$')" "${d#./}"; done | sort -rn

# Project resolution: origin identity vs registered repo.path
git -C <cwd> remote get-url origin
git -C <cwd> rev-parse --path-format=absolute --git-common-dir   # worktree → main checkout
cat ~/.bertrand/projects.json

# Conversation rows vs transcripts on disk (bertrand project)
DB=~/.bertrand/projects/bertrand/bertrand.db
sqlite3 "$DB" "select id from conversations;" | sort > /tmp/convo_ids.txt
for d in ~/.claude/projects/*bertrand*/; do
  for f in "$d"*.jsonl; do b="${f##*/}"; echo "${b%.jsonl}"; done
done | sort -u > /tmp/disk_ids.txt
comm -13 /tmp/convo_ids.txt /tmp/disk_ids.txt | wc -l   # transcripts bertrand never saw

# Resume frequency, pid state, name source
sqlite3 "$DB" "select conversation_id, count(*) c from events
               where event='claude.started' group by conversation_id having c>1;"
sqlite3 "$DB" "select n, count(*) from (select s.id, count(c.id) n from sessions s
               left join conversations c on c.session_id=s.id group by s.id) group by n;"
sqlite3 "$DB" "select count(*) from sessions where pid is null;"
sqlite3 "$DB" "select name_source, count(*) from sessions group by name_source;"
```

## Appendix B — related records

- `docs/orca-boundary.md` — Workstream 3 is the parent of this work; Part 1 is why
  hooks reach an Orca-spawned claude at all.
- `docs/derived-session-naming.md` — why a payload-created session never needs to
  prompt for a name.
- ELKY-179 — Phase 1 (explicit adoption) and its Task 1 spike, which established
  `CLAUDE_CODE_SESSION_ID` == payload `session_id` == transcript filename.
- ELKY-174 — the six hook guards. ELKY-175 — auto-create, gated by this doc.
