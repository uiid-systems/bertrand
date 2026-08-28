# Bertrand ↔ Orca: boundary, overlap, and teardown sequence

> **Status:** analysis complete, no code changed. This is a decision record and a
> handoff for task breakdown.
> **Produced in:** bertrand session `spike/orca-usage`, 2026-08-28 — the first
> session run inside [Orca](https://www.onorca.dev) (v1.4.191, `com.stablyai.orca`).
> **Recover the full discussion with:** `bertrand log spike/orca-usage`

## How to use this document

Part 1 is settled fact — compatibility is proven, not predicted. Parts 2–4 are the
measured evidence. Part 5 is the proposed work. Parts 6–7 are what is deliberately
unresolved and what we are choosing not to do.

Every number here is reproducible; Appendix B gives the exact command for each.
**Re-derive before acting** — the LOC counts and adoption stats will drift.

---

## TL;DR — what was decided

1. **Bertrand and Orca are fully compatible.** Running claude inside a bertrand
   shell blocks nothing from Orca. Proven live, not inferred (Part 1).
2. **Remove all worktree/preview features from bertrand.** Not because Orca does
   them better, but because they have **3.9% adoption across 154 sessions** and have
   never worked properly. (User decision, this session.)
3. **Derive session names instead of prompting for them.** The `category`
   taxonomy is empirically fragmenting; `slug` is auto-derivable at parity or
   better from the first prompt, at pause time. (User accepted.)
4. **Do not bind bertrand to Orca.** The user is still evaluating Orca and expects
   to possibly switch hosts within a year. Cut toward host-agnosticism, not toward
   Orca (Part 3).
5. **Sequence:** teardown → naming → launcher-optional → layer extraction.
   ~7–12 focused sessions total.

---

## Part 1 — Compatibility (settled)

### The question

Does running claude inside a bertrand shell block anything from Orca running
claude directly?

### Answer: no. Nothing.

### Why it works

Orca's Claude Code integration is **entirely hook-based**. It never needs to be
claude's parent process:

```
~/.claude/settings.json
  └── ~/.orca/agent-hooks/claude-hook.sh
        └── POST http://127.0.0.1:${ORCA_AGENT_HOOK_PORT}/hook/claude
              -H "X-Orca-Agent-Hook-Token: ${ORCA_AGENT_HOOK_TOKEN}"
              --data-urlencode paneKey/tabId/launchToken/worktreeId/payload
```

Session identity travels in **env vars**, not process lineage:
`ORCA_PANE_KEY`, `ORCA_TAB_ID`, `ORCA_TERMINAL_HANDLE`, `ORCA_WORKTREE_ID`.

Observed process ancestry in this session:

```
Orca (66667)
└── Orca Helper (66780)
    └── /usr/bin/login (73513)
        └── zsh (73521)                  ← Orca's terminal pane
            └── bun (73715)              ← bertrand
                └── claude (74142)       ← --session-id … --append-system-prompt …
```

Bertrand is an ordinary child inside Orca's pane. The load-bearing line is
**`src/engine/process.ts:52`**:

```ts
const env = { ...process.env, BERTRAND_CLAUDE_ID: …, BERTRAND_SESSION: …, … };
```

A full env spread — so every `ORCA_*` var reaches claude and, transitively, every
hook subprocess. **Any future refactor of `launchClaude` must preserve this spread**
or Orca (and any comparable host) goes blind.

### Live proof

`~/Library/Application Support/orca/agent-hooks/last-status.json` contained an
entry for this pane while the session ran:

```json
{
  "paneKey": "0183119d-…:72655a69-…",
  "source": "claude",
  "worktreeId": "6aa5d27d-…::/Users/adamfratino/www/uiid/bertrand",
  "hookEventName": "PreToolUse",
  "providerSession": {
    "key": "session_id",
    "id": "9a0e5892-7aa0-44ab-88a1-9c71e25b1766",
    "transcriptPath": "/Users/adamfratino/.claude/projects/…/9a0e5892-….jsonl"
  },
  "payload": { "state": "working", "prompt": "for the first time, you are inside of an orca session…", … }
}
```

That is bertrand's own `--session-id`, captured by Orca, for a session Orca did not
launch. **This single fact underpins Workstream 3.**

### Hooks coexist — both installers merge non-destructively

`~/.claude/settings.json` holds both tools' hooks side by side. Claude Code fires
every matching entry, so both get every event.

- **bertrand → Orca is safe by code:** `src/hooks/settings.ts`
  `installHookSettings()` filters only groups whose command contains
  `.bertrand/hooks/` (`isBertrandGroup`), and writes only `settings.hooks`.
  Orca's entries and its `statusLine` are untouched.
- **Orca → bertrand is safe by evidence:** bertrand's merge appends its own groups
  *last*, yet the observed `PreToolUse` order is `[RTK, BERTRAND, ORCA]`. Orca
  therefore wrote after bertrand and preserved both.

Per-event ownership as observed:

| Event | Owners |
|---|---|
| `PreToolUse` | RTK (`Bash`), bertrand (`AskUserQuestion`), Orca (`*`) |
| `PostToolUse` | bertrand (`AskUserQuestion`, `EnterWorktree`, `ExitWorktree`, `""`), Orca (`*`) |
| `PermissionRequest` | bertrand (`""`), Orca (`*`) |
| `Stop` | bertrand (`""`), Orca |
| `UserPromptSubmit` | bertrand (`""`), Orca |
| `SessionStart`, `StopFailure`, `SubagentStart`, `SubagentStop`, `TeammateIdle`, `PostToolUseFailure`, `PostCompact` | Orca only |

Note the last row: **Orca hooks 7 events bertrand does not.** `SessionStart` and
`PostCompact` in particular are relevant to Workstream 3.

### Input path is intact

Orca writes to the pane PTY → bertrand's raw-mode stdin → `pty.write(chunk)` →
claude. Every prompt in this session arrived that way.

### Soft edges (non-blocking, but record them)

1. **`ORCA_AGENT_LAUNCH_TOKEN` is absent** because Orca didn't spawn claude. It is
   optional everywhere (`process.env.ORCA_AGENT_LAUNCH_TOKEN || ""`; optional field
   in `agent-hook-listener/hook-envelope.js`), and
   `readOrchestrationCompatibilityEvidence()` returns valid evidence from
   `terminalHandle`/`paneKey` alone. Consequence: `connectionId: null` — bertrand
   sessions are **observed but not Orca-managed**, so Orca's supervised-worker
   orchestration (`orchestration worker-start/stop`, dispatch fencing) cannot drive
   them.
2. **`statusLine` is a single slot and Orca owns it.** Unlike `hooks` (arrays), it
   cannot be shared. Bertrand does not set it today. **If bertrand ever wants a
   statusline, this is a real mutual-clobber conflict.**
3. **`orca agent hooks off`** "removes local hook entries" — its blast radius on
   bertrand's entries was **not verified**. Worth checking before recommending it.
4. **Worktree identity can diverge.** Orca stamps `ORCA_WORKTREE_ID` at pane
   creation and won't follow a mid-session `EnterWorktree` cwd change. Moot once
   Workstream 1 lands.

---

## Part 2 — Measured overlap

Bertrand is ~28,800 LOC non-test (`src/` 18,317 + `dashboard/src` 10,522).

| # | Surface | Bertrand LOC | Orca equivalent | Verdict |
|---|---|---|---|---|
| 1 | Worktrees + previews | ~3,400 | `worktree` ×7 + a browser tab per worktree | **Total loss** |
| 2 | Terminal / PTY | 1,529 (`src/engine`) + dashboard xterm | `terminal` ×11 incl. `read`/`send`/`wait`/`split` — agent-drivable | **Orca richer** |
| 3 | Projects / repos | ~880 (`projects/registry` 362, `migrate-repo` 223, `policy` 151, `migrate-layout` 143) | `project` ×7 + `repo` ×5, with `projectId: github:uiid-systems/bertrand`, host setups, clone/import, `set-base-ref` | **Orca richer** |
| 4 | GitHub / PR | ~1,550 (`github/pr` 397, `gh` 312, `identity` 273, `errors` 225, `resolve` 215, `session-pr` 128) | `linkedPR` / `linkedIssue` / `linkedLinearIssue` per worktree | **Partial** — bertrand's CI checks are richer |
| 5 | Remote / sync | 674 (`src/sync`) | `environment` ×4, `host`, remote runtime, mobile companion | **Orca richer** |
| 6 | Hook install | 730 (`src/hooks`) | `agent hooks on/off/status` | Same file, same mechanism |

**≈8,700 LOC — roughly a third of bertrand — that Orca already does, mostly better.**

Orca exposes **232 agent-callable commands** (`orca agent-context --json`):
`orchestration` 29, `linear` 27, `emulator` 16, `computer` 14, `tab` 13,
`terminal` 11, `automations` 7, `project` 7, `worktree` 7, `skills` 6, `storage` 6,
`artifacts` 5, `repo` 5, `agent` 4, `environment` 4.

### The moat Orca has zero commands for

`src/db` (1,786) · `digest.ts` (213) · `transcript.ts` (304) · `search.ts` (268) ·
`compact.ts` (160) · `summary.ts` (120) · `timing.ts` (254) · `diff_stats.ts` (209) ·
`src/contract/` (83 — sibling-session injection).

**Orca does not persist conversation history, and this is structural, not an
oversight.** Its transcript access is exclusively *last-entry* reads:

```
agent-hook-listener/transcript-reader.js
  readLastAssistantFromTranscriptOnce, readLastTextFromTranscriptOnce,
  findLastExtractedTranscriptLineText
agent-hook-listener/command-code-transcript.js
  readLastCommandCodeAssistantFromTranscript, findLastCommandCodePromptInRegion
```

Those exist to render pane status and agent titles. `last-status.json` entries are
flagged `retainedForLiveness`. `orchestration.db` holds task/dispatch state.
Nothing stores a conversation.

> **Orca knows what is happening. Bertrand knows what happened.**
> Of 232 Orca commands, none do session recall.

---

## Part 3 — The strategic reframe

The session opened with "how do we pair these tools / defer to Orca." That framing
is wrong, for a reason that came out of the user's own constraints:

- **Audience:** open-source, in layers. Layer 1 = the logger, sibling-session
  search, TUI. Layer 2 = timeline + data viz. Layer 3 = a full in-browser dashboard
  ("feels very far away").
- **Orca commitment:** *still evaluating.* "busy space with lots of competition…
  maybe a year from now we change to something else."

Binding bertrand to `orca` commands would trade a maintenance burden for a
dependency on an unmade bet. So:

> **Don't cut to complement Orca. Cut to own the axis no host owns.**

Worktrees, terminals, previews, and projects are table stakes that *every* mature
host builds — Orca, Conductor, and whatever follows. Durable cross-session memory
is what none of them build. Cutting toward that makes the Orca decision irrelevant,
which is exactly what you want while still evaluating it.

The user's own layering already encodes this: **Layers 1–2 are the moat and don't
compete. Layer 3 is the only layer that competes, and it's far away.**

### The structural insight (biggest finding of the session)

Every bertrand hook script begins:

```sh
sid="${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0
```

(`src/hooks/scripts.ts` lines 41-42, 84-85, 129-130, 164-165, 253-254, 295-296,
354-355, 379-380.)

**Bertrand's memory only works if bertrand launched the session.** That is *why* it
built a PTY wrapper, an engine, and a TUI launcher — ~3,500 LOC — not to compete on
terminals, but because owning the process was the only way to inject one env var.

Orca proves this is unnecessary: it records `providerSession: { key: "session_id",
id, transcriptPath }` straight from the hook payload, for a session it did not
launch. **Claude Code hands every hook the session id and transcript path for free.**

Keying off the payload instead of an injected env var makes bertrand
**launcher-optional**, and therefore host-agnostic *without any Orca dependency*.

---

## Part 4 — Evidence base

### 4a. Worktrees have 3.9% adoption

| Project | Sessions | With a worktree |
|---|---|---|
| balance | 48 | 3 |
| bertrand | 52 | **0** |
| design-system | 32 | 2 |
| tabs-backend | 22 | 1 |
| **Total** | **154** | **6 (3.9%)** |

The most expensive, most Orca-overlapped surface in bertrand isn't losing a
competition — **it was never used.** This is a stronger justification for removal
than any comparison to Orca.

**Corollary that de-risks teardown:** `server/index.ts`'s `cachedWorktreeFiles`
guards on `if (!session.worktreePath) return`, and that column is null for all 52
bertrand sessions. Git enrichment of changed-files has **never executed** in this
project. Changed-files is purely timeline-derived (`diff_stats` accumulator over
`tool.applied` events) and survives teardown untouched.

### 4b. The `category` taxonomy is fragmenting

52 sessions across ~20 categories:

```
dashboard 13 · timeline 7 · bugs 5 · sidebar 4 · workspaces 3 · terminal 2 ·
spike 2 · pty 2 · cli 2 · worktrees 1 · tui 1 · taxonomy 1 · status-bar 1 ·
sessions 1 · session-exit 1 · navigation 1 · markdown 1 · issues 1 · icons 1 ·
hooks 1
```

**Eleven categories hold exactly one session**, and it is splitting into
near-duplicates:

- `terminal` (2) vs `pty` (2)
- `workspaces` (3) vs `worktrees` (1)
- `sidebar` (4) vs `navigation` (1) vs `status-bar` (1)
- `sessions` (1) vs `session-exit` (1)

Classic free-text-hierarchy failure. It costs a table, migrations, a TUI screen and
~20 consumption sites, and returns a fragmented tree. The taxonomy has already
churned once — one recorded prompt reads *"changing our sessions from
group/session to group/category/session."*

**Decision: drop `category`. Project already supplies durable grouping (a separate
DB per project). Add labels later if differentiation is needed.**

### 4c. `slug` is auto-derivable at parity or better

Human name vs. first recorded prompt:

| Human name | First prompt (truncated) | Assessment |
|---|---|---|
| `pty/220-fix-merge-conflicts` | "fix up the merge conflicts in …/pull/220" | derivable, PR number included |
| `dashboard/fix-broken-dashboard` | "why is our local bertrand server broken?" | derivable |
| `sidebar/collapsible-refactor` | "refactor our sidebar to use [collapsibles]" | derivable |
| `markdown/fix-url-parser` | "we recently added a url parser for github…" | derivable |
| `worktrees/issue-183-…` | "have a look at …/issues/183" | derivable, issue number included |
| `dashboard/integrate-xterm` | "issues in how our **xterm is sized**" | auto is **more accurate** — the session was about sizing, not integrating |
| `pty/fix-grossness` | "why does the terminal look like shit…" | auto is more descriptive |
| `workspaces/continue-workspace-work` | "have a thorough look at PR 152" | `pr-152` beats the human name |
| `spike/pty-wrapper` | "please have a look at [conductor] and [orca]…" | **fails** — prompt is a pointer; intent appears later |
| `database/run-migration` | "we did a ton of work over the weekend…" | **fails** — human name better |

**~70% derivable at parity or better; several human names are demonstrably worse.**

Two findings that dissolve the naming blocker:

1. **Structured identifiers are already in the prompts.** GitHub PR/issue URLs
   recur (`pull/220`, `issues/183`, `pull/152`), and bertrand already owns a URL
   parser plus `src/lib/github/*`. Those yield unambiguous slugs for free.
2. **Naming should happen at pause, not launch.** The TUI names a session at the
   moment of *least* information. `src/lib/summary.ts` already derives a
   subject/outcome at pause time, LLM-free and with zero user steps, precisely
   because "after the user picks 'Done for now' … the agent never gets another
   turn." Deriving the slug there strictly beats the TUI — **the failing ~30% above
   are exactly the sessions whose intent only becomes clear later.**

`sessions.summary` is already populated for 32/52 bertrand sessions.

### 4d. Current `sessions` schema

```
id TEXT PK · category_id TEXT NOT NULL · slug TEXT NOT NULL · name TEXT NOT NULL
status TEXT DEFAULT 'paused' · summary TEXT · pid INTEGER
started_at · ended_at · created_at · updated_at · rating INTEGER
worktree_path TEXT · worktree_branch TEXT · pid_started_at INTEGER
```

Event names in use: `tool.used` 5292 · `assistant.message` 1498 ·
`tool.applied` 1346 · `session.waiting` 356 · `session.answered` 352 ·
`user.prompt` 139 · `context.snapshot` 81 · `permission.request` 76 ·
`permission.resolve` 68 · `claude.ended` 63 · `claude.started` 59 ·
`assistant.recap` 28. Prompt text lives at `events.meta` → `$.prompt`.

---

## Part 5 — Workstreams

Dependency-ordered. **#1 is independent. #3 requires #2. #4 requires all.**

### Workstream 1 — Worktree teardown · risk LOW · 1–2 sessions

Decided by the user: *"we will most likely remove all worktree-related features
from bertrand … it has never worked properly and now that i'm using orca i don't
think it needs to be a bertrand feature at all."*

Scope:
- Delete 23 files, ~4,900 LOC incl. ~1,900 test LOC (Appendix A).
- Unwire ~40 referencing files (Appendix A) — **grep over-counts**; several match
  "workspace" in an unrelated sense (e.g. `dashboard/src/components/markdown/linear-url.ts`
  matches *Linear* workspace, `lib/projects/migrate-repo.ts` matches repo workspace).
  Verify each.
- One new migration: drop `sessions.worktree_path`, `sessions.worktree_branch`.
- Stop emitting `worktree.entered` / `worktree.exited`; **keep historical event rows**
  so old timelines still render.
- Remove `EnterWorktree` / `ExitWorktree` groups from `BERTRAND_HOOKS` in
  `src/hooks/settings.ts`, and the two scripts from `src/hooks/scripts.ts`.
  (Note: `installHookSettings`'s prune loop already removes stale bertrand groups
  from retired event types — verify it covers matcher-scoped `PostToolUse` groups.)
- Remove `bertrand open` from `src/cli/` + `src/cli/help.ts`.
- Retire `docs/workspaces.md` (24.4K) and the worktree parts of `docs/pty-wrapper.md`.
- Check `src/lib/stats-snapshot.ts` and `src/lib/usage-backfill.ts`, which snapshot
  git-derived stats before a worktree is removed (PR #256) — that trigger disappears.

Watch: Files-changed sidebar. See 4a — it never used the git path here, so it should
survive untouched. **Verify with a session that has changed files before merging.**

### Workstream 2 — Naming: drop category, derive slug at pause · risk MED-HIGH · 2–3 sessions

Scope:
- Migration flattening `categories` + `sessions.category_id` across **4 DBs /
  154 sessions**. Preserve a lookup path for existing `category/slug` names —
  every `bertrand log <name>` the user has ever typed, and the sibling-context
  block, use them.
- Rewrite `src/lib/parse-session-name.ts` (the `category/slug` parser).
- Update ~20 consumption sites: `cli/commands/{log,list,search,archive,stats,contract,backfill-stats}.ts`,
  `src/contract/context.ts`, `src/lib/{search,compact,catalog,session-archive}.ts`,
  `src/db/{schema,queries/sessions}.ts`, `src/server/index.ts`,
  `src/tui/screens/launch/*`, dashboard sidebar zones.
- Extend `src/lib/summary.ts` (already runs at pause) to derive a slug. Add
  PR/issue-URL extraction using existing `src/lib/github/*`.
- Optional follow-on: a label system for differentiation (user's suggestion —
  *"if we need to differentiate in bertrand down the line we could possibly
  introduce a labeling system"*).

Risk: this changes the identity of every session. Needs a back-compat story.

### Workstream 3 — Launcher-optional · risk HIGH · 2–4 sessions + design doc

Scope:
- Rewrite all 8 hook scripts to key off the payload's `session_id` (and
  `transcript_path`) instead of `BERTRAND_SESSION`. Orca's
  `agent-hook-listener` is a working reference implementation.
- Auto-create a bertrand session on the first unseen `session_id`; resolve the
  project from cwd. Consider hooking `SessionStart` (bertrand currently does not).
- Demote `src/engine` (1,529) and `src/tui` (1,994) from foundation to optional
  convenience. **Do not delete** — the PTY relay is the only path to Layer 3.
- Keep `BERTRAND_*` env vars as an override when bertrand *is* the launcher.

**Blocked on #2:** a hook-created session cannot prompt anyone for a name.

Open design questions: dedupe when both env and payload identify a session;
`--resume` handling; how `claude_id` relates to the payload `session_id` (today
they are the same value — bertrand passes `--session-id $claudeId`).

### Workstream 4 — Layer extraction (open-source packaging) · risk MED · 2–3 sessions · DEFER

Make the user's own layering structural:

- **Layer 1 (core):** `src/db` + `src/hooks` + `src/contract` + `digest`/`search`/
  `transcript`/`summary`/`compact` + CLI. "The logger, the command line tooling to
  search sibling sessions, the TUI."
- **Layer 2:** timeline + data viz (dashboard, read-only).
- **Layer 3:** full in-browser dashboard. User: *"feels very far away right now."*

Everything host-shaped becomes optional. Requires no Orca decision.

---

## Part 6 — Assumptions to validate

- [ ] **Hook payload carries `session_id` on every event bertrand needs**
      (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
      `PermissionRequest`, `Stop`). Strongly evidenced by Orca's `last-status.json`
      for `SessionStart` and `PreToolUse`; **not verified for the rest.** Test by
      logging raw payloads from a scratch hook.
- [ ] **Auto-derived slugs are good enough in practice.** 4c says ~70% at
      parity-or-better on 20 sampled sessions. Validate over all 154 before
      committing, and decide the fallback for the failing ~30% (late rename? a
      `bertrand name` command?).
- [ ] **Dropping `category` doesn't degrade `bertrand log`/`search`.** Project +
      auto-slug + labels must remain as findable as `category/slug`.
- [ ] **`orca agent hooks off` does not remove bertrand's hook entries.** Unverified.
- [ ] **Teardown doesn't regress Files-changed.** 4a argues it can't; prove it.

### What could kill this

- If curated names are what make the session corpus valuable, auto-naming makes it
  *bigger but worse*. 4c argues the opposite for `category` (already failing) but
  the `slug` case rests on a 20-session sample.
- If bertrand becomes launcher-optional and the user stops launching through it,
  session *naming and grouping* may drift toward noise without the TUI's implicit
  curation gate.

### What we're deliberately ignoring

- Layer 3 (browser dashboard with a live terminal). The PTY relay stays dormant
  rather than being deleted.
- Orca's `orchestration` (29 commands) and `linear` (27) surfaces. Bertrand has no
  ambitions there.

---

## Part 7 — Not doing (and why)

- **Not deleting worktree code in order to call `orca worktree current`.** The user
  is still evaluating Orca. Removal is justified by 3.9% adoption, not by Orca.
- **Not building a `Host` adapter (`orca`/`git`/`none`) yet.** One host used for one
  session is not a pattern; that's speculative generality. Revisit only if a second
  host becomes real.
- **Not creating Linear projects.** The connected Linear workspace is
  **Tabs-Platform** (the user's employer) — no `uiid` team, no `bertrand` project
  exists, and only one workspace is reachable via the MCP connection. Personal
  open-source planning does not belong there. GitHub issues/milestones on
  `uiid-systems/bertrand` are the natural home; release-please already lives there.
- **Not competing on terminals, previews, projects, or orchestration.** Table stakes
  every host builds.
- **Not deleting `src/engine` / `src/tui`.** Demote, don't destroy — they're the only
  route to Layer 3.
- **Not adding a bertrand statusline.** Orca owns that single slot; see Part 1.

---

## Appendix A — Exact file inventory for Workstream 1

### Delete (23 files, ~4,900 LOC incl. tests)

```
src/lib/workspace/config.ts            src/lib/workspace/config.test.ts
src/lib/workspace/detect.ts            src/lib/workspace/detect.test.ts
src/lib/workspace/env.ts               src/lib/workspace/env.test.ts
src/lib/workspace/port.ts              src/lib/workspace/port.test.ts
src/lib/workspace/resolve.ts           src/lib/workspace/resolve.test.ts
src/lib/workspace/server.ts            src/lib/workspace/server.test.ts   ← 571 + 573 LOC
src/lib/workspace/types.ts             src/lib/workspace/index.ts
src/lib/worktree-create.ts             src/lib/worktree-create.test.ts
src/lib/worktree-remove.ts             src/lib/worktree-remove.test.ts
src/lib/worktree-remove-types.ts
src/cli/commands/open.ts
dashboard/src/routes/worktrees.tsx
dashboard/src/components/worktrees/{index.ts,worktree-zone.tsx,worktree-item.tsx,changed-file-row.tsx}
```

### Unwire (verify each — grep over-counts)

```
src/cli/commands/log.ts            src/cli/commands/update.ts       src/cli/help.ts
src/contract/context.ts            src/db/events/emit.ts            src/db/queries/sessions.ts
src/db/queries/stats.ts            src/db/schema.ts                 src/engine/dashboard-session.ts
src/hooks/runtime.ts               src/hooks/scripts.ts             src/hooks/settings.ts
src/lib/catalog.ts                 src/lib/diff_stats.ts            src/lib/digest.ts
src/lib/git-types.ts               src/lib/git.ts                   src/lib/github/resolve.ts
src/lib/github/session-pr.ts       src/lib/process-identity.ts      src/lib/projects/migrate-repo.ts
src/lib/session-archive.ts         src/lib/stats-snapshot.ts        src/lib/timing.ts
src/lib/usage-backfill.ts          src/server/index.ts              src/types.ts

dashboard/src/api/queries.ts       dashboard/src/api/types.ts
dashboard/src/api/use-session-exit-actions.tsx
dashboard/src/components/markdown/linear-url.ts        ← likely false positive
dashboard/src/components/open-in-editor-button.tsx
dashboard/src/components/open-on-github-button.tsx
dashboard/src/components/secondary-sidebar/{index.tsx,changed-files-zone.tsx,pull-request-card.tsx}
dashboard/src/components/sidebar/subcomponents/{project-zone.tsx,session-content.tsx}
dashboard/src/components/timeline/session_started_content.tsx
dashboard/src/components/topbar/index.tsx
dashboard/src/lib/editor.ts        dashboard/src/lib/timeline/segments.ts
dashboard/src/routeTree.gen.ts     ← generated, will regenerate
```

Historical migrations (`src/db/migrations/**`, incl. `meta/*_snapshot.json`) mention
worktrees but are **immutable history — do not edit.** Add a new migration instead.

Server routes to remove: `/api/worktrees`, `/api/worktrees/:id/files`, and the
`cachedWorktreeBranch` / `cachedWorktreeFiles` helpers in `src/server/index.ts`
(~lines 128–400).

## Appendix B — Reproducing every number

```bash
# Process ancestry
pid=$$; while [ "$pid" -gt 1 ]; do ps -o pid=,ppid=,comm= -p $pid; \
  pid=$(ps -o ppid= -p $pid | tr -d ' '); done

# Orca env + live status
env | grep -i orca
cat "$HOME/Library/Application Support/orca/agent-hooks/last-status.json" | python3 -m json.tool

# Hook ownership per event
python3 -c "import json;d=json.load(open('$HOME/.claude/settings.json'));\
[print(ev,[('ORCA' if 'orca' in h['command'] else 'BERTRAND' if 'bertrand' in h['command'] else 'other') \
for g in gs for h in g['hooks']]) for ev,gs in d['hooks'].items()]"

# Orca's agent-callable surface
export PATH="/Applications/Orca.app/Contents/Resources/bin:$PATH"
orca agent-context --json | python3 -c "import json,sys,collections;\
c=json.load(sys.stdin)['commands'];\
print(collections.Counter(x['name'].split()[0] for x in c))"
orca worktree current

# Bertrand LOC by area (non-test)
for d in src/*/; do echo "$(find $d -name '*.ts' -o -name '*.tsx' | grep -v '\.test\.' \
  | xargs wc -l | tail -1 | awk '{print $1}') $d"; done | sort -rn

# Worktree adoption across all projects
for db in ~/.bertrand/projects/*/bertrand.db; do echo "$(basename $(dirname $db)): \
$(sqlite3 "$db" "SELECT COUNT(*)||'/'||SUM(worktree_path IS NOT NULL AND worktree_path<>'') FROM sessions;")"; done

# Category distribution
sqlite3 "$BERTRAND_PROJECT_DB" "SELECT c.name, COUNT(s.id) FROM categories c \
  LEFT JOIN sessions s ON s.category_id=c.id GROUP BY c.name ORDER BY 2 DESC;"

# Human name vs first prompt
sqlite3 "$BERTRAND_PROJECT_DB" "SELECT c.name||'/'||s.slug||'  <<<  '|| \
  substr(json_extract((SELECT e.meta FROM events e WHERE e.session_id=s.id \
  AND e.event='user.prompt' ORDER BY e.created_at LIMIT 1),'\$.prompt'),1,90) \
  FROM sessions s JOIN categories c ON c.id=s.category_id ORDER BY s.created_at DESC;"
```

## Appendix C — Key code references

| Fact | Location |
|---|---|
| Full env spread to claude (**must preserve**) | `src/engine/process.ts:52` |
| Hook guard requiring `BERTRAND_SESSION` | `src/hooks/scripts.ts:41,84,129,164,253,295,354,379` |
| Non-destructive settings merge + `isBertrandGroup` | `src/hooks/settings.ts` |
| Pause-time, LLM-free summary derivation | `src/lib/summary.ts` |
| Worktree-path guard on changed-files | `src/server/index.ts:145` |
| Orca hook transport | `~/.orca/agent-hooks/claude-hook.sh` |
| Orca orchestration identity triple | `Orca.app/…/out/shared/orchestration-compatibility-evidence.js` |
| Orca last-entry-only transcript reads | `Orca.app/…/out/shared/agent-hook-listener/transcript-reader.js` |
| Orca CLI entrypoint | `/Applications/Orca.app/Contents/Resources/bin/orca` |
