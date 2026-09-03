# Bertrand ↔ Orca: boundary, overlap, and teardown sequence

> **Status:** analysis complete, no code changed. This is a decision record and a
> handoff for task breakdown. Two of the five open assumptions were subsequently
> validated (see Part 6); the naming assumption now rests on all 154 sessions, not a
> 20-session sample.
> **Produced in:** bertrand session `spike/orca-usage`, 2026-08-28 — the first
> session run inside [Orca](https://www.onorca.dev) (v1.4.191, `com.stablyai.orca`).
> **Recover the full discussion with:** `bertrand log spike/orca-usage`
> **Amended:** 2026-08-30 from the user's **personal laptop** (bertrand session
> `teardown/receive-doc`). Three claims turned out to be scoped to the machine the
> spike ran on rather than universal, and are corrected in place: the adoption table
> (4a), the changed-files "never executed" corollary (4a), and the Linear
> availability claim (Part 7). Grep this doc for `2026-08-30`.
> **Amended:** 2026-09-03 — §4d's "current schema" had gone stale as the
> workstreams landed. Restated as of that date, with the dropped columns and the
> migrations that dropped them listed beneath it. Grep for `2026-09-03`.

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
   them better, but because adoption is **3.9%–8.3%** (3.9% over 154 sessions on the
   work machine; 8.3% over 96 on the personal laptop — see 4a) and they have never
   worked properly. (User decision, this session.)
3. **Derive session names instead of prompting for them.** The `category`
   taxonomy is empirically fragmenting; `slug` is auto-derivable at parity or
   better from the first prompt, at pause time. (User accepted.)
4. **Do not bind bertrand to Orca.** The user is still evaluating Orca and expects
   to possibly switch hosts within a year. Cut toward host-agnosticism, not toward
   Orca (Part 3).
5. **Sequence:** teardown → naming → launcher-optional → layer extraction.
   ~7–12 focused sessions total.
6. **Latent bug found and FIXED in this session.** `src/lib/transcript.ts`
   located transcripts by *deriving* the filename from the session id
   (`~/.claude/projects/{dir}/{sessionId}.jsonl`). Orca's source carries an explicit
   vendor warning that *"recent Claude Code names the transcript file with a UUID that
   differs from the hook session_id (so the id-based glob no longer finds it)."*

   **Corrected blast radius** (an earlier draft of this doc overstated it):
   transcript *ingestion* was never affected — the hooks already extract the
   authoritative `transcript_path` from the payload (`src/hooks/scripts.ts:68,177,309`)
   and pass it to `ingestTranscript`. The derived path fed exactly one caller:
   `claudeSessionExists` → `planResume` (`src/engine/resume-plan.ts:112`), which
   decides `--resume` vs `--session-id`. A miss there silently downgrades a resume and,
   in that function's own words, "hand[s] the user a blank conversation wearing the old
   one's id."

   Fixed by `findClaudeTranscript()`: keep the derived path as the fast path, and when
   it is absent scan the project directory matching each file's own `sessionId` (every
   transcript entry carries one on line 0). No schema change, no hook change.

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
3. **`orca agent hooks off` is safe** (verified 2026-08-28 by reading
   `out/main/chunks/managed-agent-hook-controls-*.js`). Its removal path is
   `removeManagedCommands(definitions, isManagedCommand)` where the predicate comes
   from `createManagedCommandMatcher(scriptFileName)` — matching **its own script
   filename**. It can only strip entries pointing at `claude-hook.sh`. This is exactly
   symmetric with bertrand's `isBertrandGroup` matching `.bertrand/hooks/`: both tools
   scope teardown by ownership-by-path. (Read from minified source, not live-tested —
   running it would disable Orca's hooks.)
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

### 4a. Worktree adoption is low on every machine measured (3.9%–8.3%)

Measured on the **work machine**, 2026-08-28:

| Project | Sessions | With a worktree |
|---|---|---|
| balance | 48 | 3 |
| bertrand | 52 | **0** |
| design-system | 32 | 2 |
| tabs-backend | 22 | 1 |
| **Total** | **154** | **6 (3.9%)** |

Re-derived on the **personal laptop**, 2026-08-30 — a different project registry, not
a correction of the table above:

| Project | Sessions | With a worktree |
|---|---|---|
| bertrand | 49 | **3** |
| design-system | 38 | 5 |
| shuff-app | 7 | 0 |
| `default` / `self-hosted` / `elky149-unbound-probe` | 2 | 0 |
| **Total** | **96** | **8 (8.3%)** |

`balance` and `tabs-backend` are not registered on the personal laptop; `shuff-app` is
not registered on the work machine. **The session corpus is split across two machines**,
so every number in Parts 2 and 4 describes whichever registry it was run against.
Re-derive on the machine you are acting from — Appendix B's commands are machine-local.

The most expensive, most Orca-overlapped surface in bertrand isn't losing a
competition — **at 3.9%–8.3% it was barely used.** This is a stronger justification for
removal than any comparison to Orca, and it holds on both machines.

**CORRECTED 2026-08-30 — the corollary that was supposed to de-risk teardown does not
hold.** An earlier draft argued that `server/index.ts`'s `cachedWorktreeFiles` guard
(`if (!session.worktreePath) return`, `src/server/index.ts:145`, plus the `existsSync`
guard at `:476`) had **never** been passed in this project, because `worktree_path` was
null for all 52 bertrand sessions on the work machine.

On the personal laptop, three bertrand sessions carry a `worktree_path` and two of
those worktrees are **live right now**:

```
.claude/worktrees/issue-249-purge-evict      [worktree-issue-249-purge-evict]
.claude/worktrees/sidebar-live-zone-groups   [worktree-sidebar-live-zone-groups]
.claude/worktrees/diff-fix-colors            [fix/diff-palette-colors]   ← no session
```

So the git-enrichment path for changed-files **has executed, and still can.** That
changed-files is purely timeline-derived (`diff_stats` accumulator over `tool.applied`
events) is now an **assertion to prove, not a given** — see Workstream 1 and Part 6.
The upside: those two live worktrees are a ready-made fixture for proving it.
**Proven 2026-08-30 in 4e:** it holds for the file list; the header's aggregate
counters are the one place a stored git number survives, and nothing recomputes them.

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

#### Full-corpus validation (all 154 sessions, 4 project DBs)

The sample above was 20 sessions. Measured across every session, scoring what
fraction of a slug's tokens appear in its own first prompt (stopwords dropped):

| Bucket | Sessions | Share |
|---|---|---|
| full (100% of slug tokens present) | 58 | 38% |
| high (≥67%) | 10 | 7% |
| partial (≥34%) | 48 | 32% |
| low (<34%) | 36 | 24% |

**152 of 154 sessions (99%) have a recorded first prompt**, so coverage is not the
constraint. Per project: balance 81%, tabs-backend 81%, bertrand 76%,
design-system 66% at ≥34%.

**Honest reading:** the 20-session "~70%" holds directionally (76% at ≥34%), but it
is optimistic if read as "70% would produce *good* names." A truer statement:
**~45% would derive cleanly, ~32% partially, ~24% need a fallback.**

The low bucket is not random — it decomposes into three actionable failure classes:

1. **Ticket-ID slugs** (`UI-132`, `UI-175`, `UI-332`, `UI-378`, `UI-493`) — the human
   name carries a Linear ID absent from the prompt text. Derivable from the *branch*
   or a tracker, not the prompt. Under Orca, `linkedLinearIssue` supplies this directly.
2. **Slash-command first prompts** (`/agent-skills:test-driven-development`,
   `/agent-skills:documentation-and-adrs`) — the opening prompt is a command
   invocation with no subject at all. Must fall back to later turns.
3. **Human-invented labels** (`brown-bag/eng-demo-1`) — no textual basis anywhere.
   Genuinely underivable; needs a rename affordance.

Classes 1 and 2 **reinforce pause-time derivation**: a slash-command prompt has no
subject, but by pause time the conversation does. Only class 3 needs a manual escape
hatch — which argues for a `bertrand rename` command rather than a launch-time prompt.

Two findings that dissolve the naming blocker:

1. **Structured identifiers appear in some prompts.** GitHub PR/issue references
   (`pull/220`, `issues/183`, `pull/152`) occur in **19 of 152 first prompts (12%)** —
   a useful signal where present, but *not* a primary naming strategy. (An earlier
   draft of this doc overstated this as "recur throughout"; the measured rate is 12%.)
   Bertrand already owns a URL parser plus `src/lib/github/*` to exploit them.
2. **Naming should happen at pause, not launch.** The TUI names a session at the
   moment of *least* information. `src/lib/summary.ts` already derives a
   subject/outcome at pause time, LLM-free and with zero user steps, precisely
   because "after the user picks 'Done for now' … the agent never gets another
   turn." Deriving the slug there strictly beats the TUI — **the failing ~30% above
   are exactly the sessions whose intent only becomes clear later.**

`sessions.summary` is already populated for 32/52 bertrand sessions.

### 4d. `sessions` schema — refreshed 2026-09-03

The column list here was the schema as of the 2026-08-28 spike. Everything this
part recommended cutting has since been cut, so it is restated as of
**2026-09-03** rather than left describing a table that no longer exists:

```
id TEXT PK · slug TEXT NOT NULL · name TEXT NOT NULL
name_source TEXT DEFAULT 'manual' NOT NULL · status TEXT DEFAULT 'paused' NOT NULL
summary TEXT · pid INTEGER · pid_started_at INTEGER
started_at · ended_at · created_at · updated_at · branch TEXT
```

Dropped since the spike:

- `category_id`, with the `categories` table (0018) — Workstream 2's flatten.
- `worktree_path` / `worktree_branch` (0015) — Workstream 1's teardown. `branch`
  is their replacement, and it is the branch *every* session has rather than the
  ~6% that had a worktree.
- `rating` (0019) — the 1-5 effectiveness score, removed with its route, its TUI
  keys, and its dashboard star control. Not a §5 workstream; a later cut in the
  same slim-down direction.

Event counts below are the spike's, not re-measured. Event names in use:
`tool.used` 5292 · `assistant.message` 1498 ·
`tool.applied` 1346 · `session.waiting` 356 · `session.answered` 352 ·
`user.prompt` 139 · `context.snapshot` 81 · `permission.request` 76 ·
`permission.resolve` 68 · `claude.ended` 63 · `claude.started` 59 ·
`assistant.recap` 28. Prompt text lives at `events.meta` → `$.prompt`.

---

### 4e. Files-changed provenance — resolved 2026-08-30 (ELKY-161)

§4a left open whether the Files-changed sidebar has any git-only provenance. Traced
against the post-#262 code and measured against every session in the personal laptop's
`bertrand` registry. **Answer: the file list has none. Three aggregate counters do, and
they are stored, not recomputed.**

**Two rendered values, two different paths.** The sidebar draws a header (`+N −N`, files
touched) and a file list beneath it. Different endpoints serve them:

| Rendered value | Endpoint | Source, post-#262 |
|---|---|---|
| File list + per-file counts | `/api/stats/:id/files` | `resolveChangedFiles` → `computeChangedFiles` — timeline replay over `tool.applied`. **No git arm.** |
| Header counters, live session | `/api/stats`, `/api/stats/:id` | `liveStats` (replay), then `withStoredGitDiffs` overlays a stored `diff_source='git'` row if one exists |
| Header counters, archived/paused | same | `getSessionStats` — the stored row verbatim, git-stamped or not |

`getWorktreeChangedFiles` no longer reaches any rendered value. #262 removed the git arm
from `resolveChangedFiles`; its only surviving caller is `readWorktreeFiles` →
`gitDiffStats` → `stats-snapshot.ts`, which is a **writer**, not a reader.

**The writer is already dead.** `snapshotGitDiffStats` has exactly one live caller left,
`src/lib/worktree-remove.ts:63` — `refreshGitStats` went in #262. No new
`diff_source='git'` row can be written unless someone tears a worktree down through
bertrand. ELKY-162 deletes that caller and the snapshot module; it removes no reader.

**What is stored, measured.** `bertrand` registry, 50 sessions:

- **46** stamped `diff_source='events'` — stored counters and a live replay agree
  **exactly, 46/46**. Header and list share one source and cannot drift.
- **1** has no stats row yet (in flight).
- **3** stamped `diff_source='git'` — and these disagree with the replay:

| Session | Stored (git) | Replay (events) |
|---|---|---|
| `add-group-collapse-to-live-zones` | +228 −115, 10 files | +329 −36, 9 files |
| `249-fix-project-remove-purge` | +600 −28, 12 files | +701 −148, 11 files |
| `ELKY-156/p514-pr-status-and-checks…` | +627 −25, 8 files | +803 −139, 11 files |

`design-system` has 5 worktree sessions and **zero** git-stamped rows. Every other
registry has zero of both.

**The git-stamped set is not the worktree set.** `worktree-remove.ts` snapshots (`:63`)
and *then* nulls the columns (`:93`), so a cleanly torn-down session keeps git numbers
with no `worktree_path` — `ELKY-156/p514` is exactly that, and it never appears in any
`worktree_path IS NOT NULL` census. Conversely `refactor-project-selector` still carries
a `worktree_path` and never got a snapshot. Treating "has a `worktree_path`" and "has
git-provenance data" as the same three rows is wrong; they overlap in two.

**Verdict against the acceptance criteria.** No rendered value has a git-only provenance
that deletion can break, because nothing recomputes these numbers — they are frozen rows
in `session_stats`, retained on the same principle as the `worktree.entered` /
`worktree.exited` events. **No replacement path is required. ELKY-162 and ELKY-164 are
cleared to proceed.**

What does remain is a **cosmetic inconsistency introduced by #262**: for those three
archived sessions the header shows git's branch-net figures while the list beneath
replays the timeline, so the rows no longer sum to the header. Before #262 both arms were
git and agreed. It affects 3 of 50 sessions, all archived, none reachable by new work.
**DECIDED 2026-08-30 — retire the overlay.** `withStoredGitDiffs` and the
`session_stats.diff_source` column go, so every session is uniformly event-derived and
the header always sums to the list beneath it. The three stored git snapshots lose their
branch-net figures and fall back to timeline replay; that is accepted. The alternatives
considered were leaving the disagreement in place (each number is individually correct,
just differently defined) and labelling the header's provenance in the UI — both rejected
as carrying a worktree-shaped concept past the teardown that removed it.

This widens two tickets: ELKY-162 removes the reader, and ELKY-164's migration drops
`session_stats.diff_source` alongside the two `sessions` worktree columns. Note the
asymmetry — the `worktree.entered` / `worktree.exited` **event rows** are still retained,
because they are history; `diff_source` is a *derived* column that changes how a value
renders today, which is why it goes and they stay.

**Adoption re-derived 2026-08-30 — unchanged.** `bertrand` 3/50, `design-system` 5/39:
the same worktree rows as before, with the totals moved only by new non-worktree
sessions. Newest worktree session is 2026-08-25 (`design-system`) and 2026-08-11
(`bertrand`). **No new worktree session has been created since the teardown was planned.**
Three worktrees remain on disk, including `diff-fix-colors`, which has no session
attached and serves as the negative control.

## Part 5 — Workstreams

Dependency-ordered. **#1 is independent. #3 requires #2. #4 requires all.**

### Workstream 1 — Worktree teardown · risk LOW · **COMPLETE 2026-08-30**

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
  *(Done — `workspaces.md` is deleted; `pty-wrapper.md` keeps its PTY material.)*
- Check `src/lib/stats-snapshot.ts` and `src/lib/usage-backfill.ts`, which snapshot
  git-derived stats before a worktree is removed (PR #256) — that trigger disappears.
- Delete `src/lib/stats-snapshot.ts` (missing from the Appendix A list below), and
  with it three exports in `src/lib/diff_stats.ts` that it is the last caller of:
  `gitDiffStats`, `WorktreeFilesReader`, `readWorktreeFiles`. ELKY-163 cut
  `resolveChangedFiles`'s git arm, so `stats-snapshot` is all that keeps them
  reachable. `resolveChangedFiles`, `computeChangedFiles` and `sumChangedFiles`
  stay — they are the timeline replay every session now uses.
- Drop the resume refusal for legacy worktree rows in `src/engine/dashboard-session.ts`
  (`resolveSessionCwd`'s `worktree-gone` arm) and its `RESUME_ERROR` entry in
  `src/server/index.ts`. ELKY-163 kept it because rows carrying a `worktree_path`
  record the *main checkout* on their last `claude.started`, so resuming one would
  commit its work to the wrong branch. Once the migration above drops the columns
  there is nothing left to refuse on.

Watch: Files-changed sidebar. 4a's "it never used the git path here" **was wrong on
the personal laptop** — two live worktrees still exercise it. Treat non-regression as a
real test with a real fixture: open a session with changed files against
`worktree-issue-249-purge-evict` or `worktree-sidebar-live-zone-groups`, capture the
sidebar before and after, and diff. **Do not merge on the argument alone.**

**Resolved — and then made moot.** 4e proved the non-regression: the file list is
timeline replay with no git arm, and 46/46 event-sourced sessions agree exactly between
stored counters and live replay. The only git-provenance values were three stored
`session_stats` rows nothing recomputes. The sidebar was then removed outright by
separate decision, so the zone the watch protected no longer exists.

#### What shipped

| Step | Ticket | Landed as |
|---|---|---|
| Unwire ~40 referencing sites | ELKY-163 | #262 |
| Prove Files-changed survives | ELKY-161 | #263 |
| Hooks + `bertrand open` | ELKY-165 | #264 |
| Delete the modules (21 files, −3,465 LOC) | ELKY-162 | #265 |
| Remove the secondary sidebar | ELKY-178 | #266 |
| Retire the docs | ELKY-166 | this change |

Four corrections the plan above got wrong, kept because the reasoning matters:

1. **`open.ts` could not go with the modules.** It was the last importer of
   `@/lib/workspace` and `getMainWorktree`, so deleting them first broke typecheck. It
   moved to ELKY-165, which now lands *before* the deletion.
2. **The prune-loop worry was unfounded.** `EnterWorktree`/`ExitWorktree` are
   matcher-scoped on `PostToolUse`, an event type bertrand still installs, so the prune
   loop skips them by design. Removal rides on the *merge* loop replacing every
   bertrand-owned group under an installed event type. Correct, but silently
   load-bearing — it now has a fixture.
3. **The git-stamped set is not the worktree set.** `worktree-remove.ts` snapshots
   before nulling the columns, so a cleanly torn-down session keeps git numbers with no
   `worktree_path`. Any census keyed on that column misses it.
4. **`sumChangedFiles` does not stay.** The list above keeps it alongside the replay
   helpers, but its only caller was `gitDiffStats`, so it went with `stats-snapshot.ts`.

#### Still open

- **ELKY-164 — the migration.** Deliberately held. `sessions.worktree_path`,
  `sessions.worktree_branch` and `session_stats.diff_source` remain on disk, but ELKY-162
  removed every reader, so they are inert. Running it is a separate, irreversible call.
- **ELKY-177 — record a branch per session.** Its premise changed: the PR card it was
  meant to light up lost its home when the sidebar went.

The `withStoredGitDiffs` overlay and the `diff_source` reads were retired in ELKY-162
rather than kept, reversing the earlier note in 4e's options list — the decision is
recorded there.

### Workstream 2 — Naming: drop category, derive slug at pause · risk MED-HIGH · **COMPLETE 2026-08-30**

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

**Landed** as ELKY-167–172 (commits `830b177`…`ed9b832`, released in 0.41.0). Categories are
flattened to a single `slug`; `getOrCreateCategoryPath` is gone. Sessions are created
unnamed with `nameSource: "derived"` and named at the first pause by `src/lib/summary.ts` —
`createSession` throws if a `derived` row carries its own display name
(`src/db/queries/sessions.ts:50`). `bertrand rename` is the manual escape hatch, and
legacy `category/slug` names resolve through an alias table.

### Workstream 3 — Launcher-optional · Phase 1 risk LOW / Phase 2 risk HIGH · IN PROGRESS

Scope:
- Rewrite all 6 hook scripts to key off the payload's `session_id` (and
  `transcript_path`) instead of `BERTRAND_SESSION`. Orca's
  `agent-hook-listener` is a working reference implementation — see
  `extractAgentProviderSession` in `out/shared/agent-session-resume.js`.
  **Today bertrand's hooks parse only `.cwd` and `.answers` from the payload**;
  everything else comes from env.
- Note: ingestion already uses the payload's authoritative `transcript_path`, and
  the resume-path gap it left was fixed separately (TL;DR item 6). So this workstream
  is about *session identity*, not transcript location — that part is already solved.
- Auto-create a bertrand session on the first unseen `session_id`; resolve the
  project from cwd. Consider hooking `SessionStart` (bertrand currently does not).
- Demote `src/engine` (1,529) and `src/tui` (1,994) from foundation to optional
  convenience. **Do not delete** — the PTY relay is the only path to Layer 3.
- Keep `BERTRAND_*` env vars as an override when bertrand *is* the launcher.

**No longer blocked on #2** — Workstream 2 is complete, and a hook-created session is
simply created unnamed and named at pause like every other session.

**Re-planned by ELKY-179 (2026-08-30).** The workstream now splits at the *trigger*, not
the plumbing:

- **Phase 1 — explicit adoption (low risk, committed).** A `/bertrand` slash command runs
  `bertrand adopt`, which writes a durable `~/.bertrand/run/adopted-<session_id>` marker.
  The hook guards gain a marker-consulting fallback; env still wins. This sidesteps
  project resolution (cwd is passed in) and drift (the user opted in deliberately).
- **Phase 2 — implicit auto-create (HIGH risk, not committed).** Everything above, but
  triggered by the first unseen `session_id` rather than by a human. Decide after Phase 1
  has run in practice. Phase 1 makes this incremental: the marker fallback becomes the
  default path.

Also note: the guard count is **6**, not 8 — the worktree hooks were deleted in
Workstream 1. Current sites are `src/hooks/scripts.ts` lines 41, 84, 129, 164, 252, 294.

One blocker not listed above: `shouldIgnoreStatusFlip` (`src/cli/commands/update.ts:33-41`)
refuses `active`/`waiting`/`blocked` flips whenever `session.pid === null`, which is the
state of every session bertrand did not launch. Payload-keyed sessions never change status
until that is fixed.

Open design questions: dedupe when both env and payload identify a session;
`--resume` handling; how `claude_id` relates to the payload `session_id` (today
they are the same value — bertrand passes `--session-id $claudeId`).

**The demotion landed** as ELKY-176. `src/engine` and `src/tui` are still there and
still the nicer path; nothing on the recording path reaches them. Three things moved:
`finalize.ts` and `recovery.ts` left `src/engine` for `src/lib` (neither touches a PTY,
and recovery is the only thing that ever finalizes an adopted session, so it has to stay
reachable from `serve`); `bertrand launch` and the server's three dashboard-session
routes now `await import(…)` instead of importing at the top; and `launchClaude`'s env
construction is extracted as `buildClaudeEnv` so the `...process.env` spread — the
channel every `ORCA_*` var rides into claude and its hooks — has a test standing over it
(`src/engine/process.test.ts`). `src/layer-boundary.test.ts` enforces the boundary two
ways: a static import walk from every Layer 1 module, and a probed run of the real
entrypoint that fails if either directory is so much as loaded.

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

- [x] **Hook payload carries `session_id` on every event bertrand needs.** VERIFIED
      2026-08-28 by reading Orca's listener. `agent-hook-listener.js` computes
      `providerSession = extractAgentProviderSession(source, hookPayloadRecord)`
      **once per incoming event, before any event-specific branching** — `eventName` is
      read separately and the extraction never consults it. `extractAgentProviderSession`
      (`out/shared/agent-session-resume.js`) switches on *provider*, not event:
      for `claude` it reads `session_id` and attaches `transcript_path`. Orca handles 13
      Claude events this way, including the 7 bertrand does not hook. So `session_id` is
      uniformly available. (Read from source; not independently instrumented.)
- [x] **Auto-derived slugs are good enough in practice.** VALIDATED over all 154
      sessions (see 4c): ~45% derive cleanly, ~32% partially, ~24% need a fallback.
      The failure set decomposes into ticket-ID slugs, slash-command openings, and
      human-invented labels. **Remaining decision:** the escape hatch for class 3 —
      a `bertrand rename` command is the recommended shape.
- [ ] **Dropping `category` doesn't degrade `bertrand log`/`search`.** Project +
      auto-slug + labels must remain as findable as `category/slug`.
- [x] **`orca agent hooks off` does not remove bertrand's hook entries.** VERIFIED by
      reading Orca's source — the predicate matches its own script filename (Part 1,
      soft edge 3). Not live-tested.
- [x] **Teardown doesn't regress Files-changed.** PROVEN 2026-08-30 — see **4e**. The
      file list is timeline replay with no git arm; only three archived sessions carry
      git-provenance *aggregates*, and those are stored rows nothing recomputes, so
      deletion cannot move them. 46/46 event-sourced sessions agree exactly between
      stored counters and live replay. No replacement path needed. One cosmetic
      header-vs-list disagreement on those three sessions is documented in 4e.

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
- ~~**Not creating Linear projects.**~~ **REVERSED 2026-08-30 — Linear is the right
  home.** The original claim (connected workspace is **Tabs-Platform**, the user's
  employer; no `uiid` team; no `bertrand` project; one workspace reachable) was an
  artifact of the **work machine's** MCP connection. From the personal laptop the
  `uiid` workspace is reachable and team key **`ELKY` resolves to "Bertrand"**,
  already holding *GitHub-Attached Projects* (Backlog) and *TypeScript rebuild*
  (Completed). The user's five most recent bertrand sessions ran as
  `github-projects/ELKY-150…156` off that board.
  **Plan the workstreams as one Linear project each on the ELKY board**, tasks in
  Todo/Backlog (never Triage), with PRs on `uiid-systems/bertrand` as today —
  release-please still lives there.
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
| Transcript lookup, derived-path fast path + id-matching scan | `src/lib/transcript.ts` → `findClaudeTranscript` |
| Hooks already extract the authoritative `transcript_path` | `src/hooks/scripts.ts:68,177,309` |
| Resume decision that the derived path fed | `src/engine/resume-plan.ts:112` |
| Ingest cursors keyed by transcript path | `src/db/schema.ts:162` |
| Generic per-event session extraction (reference impl) | `Orca.app/…/out/shared/agent-session-resume.js` → `extractAgentProviderSession` |
| Orca hook removal is filename-scoped | `Orca.app/…/out/main/chunks/managed-agent-hook-controls-*.js` → `createManagedCommandMatcher` |
| Worktree-path guard on changed-files | `src/server/index.ts:145` |
| Orca hook transport | `~/.orca/agent-hooks/claude-hook.sh` |
| Orca orchestration identity triple | `Orca.app/…/out/shared/orchestration-compatibility-evidence.js` |
| Orca last-entry-only transcript reads | `Orca.app/…/out/shared/agent-hook-listener/transcript-reader.js` |
| Orca CLI entrypoint | `/Applications/Orca.app/Contents/Resources/bin/orca` |
