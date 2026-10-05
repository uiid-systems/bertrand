# Context budget — slimmer, more relevant context instead of forced log reads

> **Status:** Tier 1 merged in #307, ships in 0.43.3 (release PR #308).
> Tier 2 built behind the `contextRecall` config flag, off by default.
> Tier 3 replay not started. See [Where this stands](#where-this-stands).
> **Produced in:** bertrand session `force-bertrand-logs`, 2026-10-05, using a
> doubt-driven cycle (fresh-context adversarial review, reconciled below).
> **Recover the full discussion with:** `bertrand log force-bertrand-logs`

## The question

Starting idea: *force bertrand sessions to check bertrand logs before any other
form of context.* Clarified goal: **save tokens by giving the agent a slimmer,
more relevant context**. Forcing the agent to run `bertrand log` is explicitly
not the mechanism (user decision).

## TL;DR — what was decided

1. **No forced log reads.** A hook that blocks until `bertrand log` runs
   produces ritual compliance (`bertrand log <self>` on an empty session), and
   it *spends* 2–5.6KB per digest (measured below). That is the opposite of the
   goal.
2. **Logs are not the most trusted context.** Logs are historical claims about
   *why* something was done and *what was tried*. Code and git are the current
   truth about *what is*. Injected history must say that it is history.
3. **Cut first.** Most of bertrand's own injected context is either
   duplicated or irrelevant. Removing it is the only part of this plan with a
   guaranteed token saving (Tier 1).
4. **Add relevance only behind a measurement** (Tiers 2–3). Retrieval injection
   saves tokens only if it replaces exploration the agent would otherwise do.
   That has not been shown yet, and a live holdout can't show it at
   bertrand's volume. Tier 3 uses a paired offline replay instead.

## Where this stands

| Item | State |
|---|---|
| Tier 1: all four cuts, plus the machine-prompt summary fix | Merged in #307. Ships in 0.43.3 (release PR #308). Re-measured on main: 9,039 → 4,458 B (force-bertrand-logs) |
| Tier 1 savings report (Tier 3.1) | Waiting for 0.43.3 to be installed and used in real conversations |
| Tier 2: resume digest, prompt-keyed retrieval, auto-adopt first prompt | Built, off by default: `{ "contextRecall": true }` in `~/.bertrand/config.json`. See [Tier 2 as built](#tier-2-as-built) |
| Tier 3.2: injected-bytes logging | Built, always on: one JSON line per delivery in `~/.bertrand/context-log.jsonl` |
| Tier 3.3: paired replay | Not started. It can now compare `contextRecall` on and off |

---

## Measured baseline (2026-10-05, work machine, `~/.bertrand/bertrand.db`)

Every number is reproducible with the commands in the appendix. **Re-derive
before acting.** They will drift.

### How much context bertrand injects today

`bertrand contract` for one session is **9,040 bytes** (~2.3k tokens):

| Section | Bytes | Share | Notes |
|---|---|---|---|
| `## bertrand CLI` | 3,452 | 38% | Identical in every session; all of it is also in `bertrand --help` |
| `## Sibling Sessions` | 3,100 | 34% | 12 most-recent sessions across **all repos** |
| `## Rules` | 1,297 | 14% | |
| `## Communicating through a turn` | 638 | 7% | |
| Preamble (loop mechanics) | 554 | 6% | |

The per-prompt reminder (`contract --short`) is 1,469 bytes and is sent on
every typed prompt after the first.

### The contract is delivered two or three times

- `launchClaude` passes the full contract via `--append-system-prompt`
  (`src/engine/process.ts:76`) and **does not write the `contract-sent-$cid`
  marker**.
- The UserPromptSubmit hook therefore sees no marker on the first prompt and
  injects the **full contract again** as `additionalContext`
  (`src/hooks/scripts.ts:491-496`).
- The `/bertrand` command then runs `contract --mark-sent`, which prints it a
  **third** time (`src/claude/commands.ts:84`), even when `adopt` has just
  reported "This claude was launched by bertrand".

Observed directly in `force-bertrand-logs`: system prompt, first-prompt hook
context, and Bash output all carried the full 9KB contract. The system-prompt
copy is prompt-cached and cheap per turn. The hook copy sits in the message
history and is carried, uncached, until compaction.

### The sibling block is mostly irrelevant

Non-archived sessions by repo: tabs-backend 44, design-system 6,
backgammon-app 4, bertrand 4.

`buildSiblingContext` (`src/contract/context.ts:18`) sorts globally by
`updatedAt` and caps at 12 (`MAX_SIBLINGS`, `:15`). For this bertrand-repo
session, **0 of the 12 injected siblings were from the bertrand repo**: 9 were
tabs-backend and 3 were backgammon-app. The three actual bertrand siblings were
crowded out.

### Do agents use bertrand's context today?

Sep 2 – Oct 5: **28 of 90** conversations with tool calls ran
`bertrand log|search|list` at all. 17 of those did so within their first five
tool calls. Up to 11 of the 28 had prompts that mention bertrand, a session, or
logs (a loose upper bound for user-prompted lookups). **62 never consulted it.**
The data does not say how many of those 62 *should* have.

### Retrieval today

`searchSessions` (`src/lib/search.ts:196-221`) is `LIKE` substring matching, with
terms AND-ed and results ordered by `updatedAt`. There is no relevance ranking.

---

## Plan

### Tier 1 — cut (guaranteed savings, no new machinery)

| Change | Where | Est. saving |
|---|---|---|
| Mark the contract as sent when bertrand *freshly* launches claude with `--append-system-prompt` (not on `--resume`, see below), so the first-prompt hook sends only the short reminder | `deliverContract` in `src/engine/process.ts`, used by `launchClaude` and `dashboard-session.ts` | ~2.3k tokens per launched conversation |
| `/bertrand`: `contract --mark-sent` prints only the rules when the conversation's marker already exists — the hook has handled the `/bertrand` prompt itself by then, so a launched or already-attached session always has it | `contractDelivery` in `src/cli/commands/contract.ts` | ~2.3k tokens when `/bertrand` is used inside a launched or attached session |
| Shrink `## bertrand CLI` to a command index plus "run `bertrand <cmd> --help`" | `helpText({ agent: true })` in `src/cli/help.ts:84`, passed as a contract layer by `contract.ts`, `session.ts`, `resume-plan.ts`, `dashboard-session.ts`; leave the human `bertrand --help` (`router.ts`) intact | ~2.9KB → ~0.5KB |
| Scope siblings: same `group_key` first, then the same repo, capped at ~5; omit the block when empty; keep the `bertrand list` pointer for anything beyond that | `src/contract/context.ts` | ~3.1KB → ≤1.3KB, often 0 |

Measured after implementing all four rows (2026-10-05, against a
`.backup` copy of the real DB):

| Session (repo) | Contract before | After |
|---|---|---|
| force-bertrand-logs (bertrand) | 9,039 B | 4,458 B |
| ui-712 (tabs-backend) | 9,074 B | 4,937 B |
| kill-server (backgammon-app) | 9,108 B | 4,269 B |

About 2.3k → 1.15k tokens per contract. With the de-duplication, a launched
conversation's opening context drops from two full contracts (~18KB) to one
trimmed contract plus the 1.5KB reminder (~6KB). The earlier ~0.8k estimate
was optimistic: the rules, loop mechanics and communication guidance (~2.5KB)
were never in scope.

**Follow-up found while measuring:** pause-time summaries (`lib/summary.ts`)
are derived from machine-generated prompts when those come first. Two of
tabs-backend's five siblings rendered as `"<task-notification> <task-id>…"`.
Fixed alongside Tier 1: derivation skips `<task-notification>` and
`<agent-message>` prompts (the only two machine kinds in the DB: 87 and 4 rows),
and the sibling block re-derives any stored summary that still leads with one.
These are typically sessions whose real first prompt was never recorded,
because auto-adoption skips a conversation's first prompt (cycle 1, #2).

**Trade-off accepted:** repo scoping hides cross-repo siblings (bertrand ↔
design-system, tabs-backend ↔ a design system). They remain reachable through
`bertrand list` and `bertrand search`. Tier 2 retrieval is the place to bring
back cross-repo hits that are *relevant*, rather than merely recent.

**Watch:** the "Must-stick rules live in hooks" principle still holds. Marking
the contract as sent only affects bertrand's own spawn. Background jobs,
nested `claude`, and external launchers never get the `--append-system-prompt`
copy, so they still get the hook's first-prompt contract.

### Tier 2 — add relevance (unproven; build only alongside Tier 3)

1. **Resume digest.** On a new conversation inside an existing session, include
   a capped digest of that session's own last N conversations (subject +
   outcome) in `buildContract`, so the argv path and the hook path both get it.
   This is the highest-precision case: 21 of 66 sessions have more than one
   conversation.
2. **Prompt-keyed retrieval**, computed *inside* `bertrand contract` (no extra
   bun spawn on a hook the user waits on), returning at most three pointers
   (session, conversation, one-line summary, date), or **nothing**.
   - **When:** the first prompt and typed prompts only. Not AUQ answers, because
     every-turn injection works against the token goal. Skip machine-generated
     prompts (`<task-notification>`, agent hand-backs: ~30% of `user.prompt`
     rows).
   - **Over what:** session summaries and conversation subjects, not raw prompt
     or assistant text. Raw snippets like "commit and PR" or "don't go down
     that path" read as live instructions.
   - **Ranking:** in-process term scoring over a 66-session corpus is enough.
     Avoid FTS5 for now (see findings #9). Tokenize and escape the prompt.
     Use a relative margin, not an absolute cutoff. De-duplicate by session.
     **Exclude the current session and conversation**: the hook records the
     prompt (`scripts.ts:488`) before the contract is built, so the best match
     would otherwise be the prompt itself.
   - **Framing:** label the block as quoted history with dates ("as of …"), and
     tell the agent that code and git outrank it.
   - **Scope:** only the local user's sessions. `bertrand sync` can bring in
     other machines' or other people's text, and that text is untrusted input.
3. **Auto-adopted conversations.** The auto-create gate exits on the first
   prompt of an unadopted conversation (`scripts.ts:189`), which is the moment
   retrieval matters most. Run retrieval on the adopting prompt using the
   back-filled history.

### Tier 2 as built

All of it is gated on `contextRecall`; with the flag off, contracts are
byte-identical to Tier 1.

- **Resume digest** (`src/contract/history.ts`). A `## Earlier in this session`
  layer in every full contract: the session's other conversations (not
  discarded, not the current one), oldest first, capped at the last three,
  one dated line each (`first prompt → last message`, the pause-time summary
  derivation applied per conversation), plus a `--conversation <id>`
  drill-in. All four contract builders now go through one
  `contractLayers()` (`src/contract/layers.ts`), so launch, resume,
  dashboard, and hook deliveries carry the same layers.
- **Prompt-keyed recall** (`src/contract/recall.ts`). The UserPromptSubmit
  hook pipes the prompt to `bertrand contract --prompt-stdin`, so recall
  costs no extra bun start. BM25 over one document per session: slug,
  summary, and the first prompt of each conversation. Gates, all tuned
  against the 66-session corpus:
  - terms in more than 20% of sessions are dropped (min. 3);
  - a hit shares at least two terms with the prompt, unless the prompt has
    a single rare term (≤3 sessions), such as a ticket id;
  - survivors score at least 60% of the best hit (0.5 let a "tests"-only
    match through on a CI prompt), at most three.

  It excludes the current session and any session already pointed to in this
  conversation (`recalled-$cid` runtime marker). It skips machine prompts and
  strips a leading `/command`. On the corpus, ten probe prompts gave
  0 hits for "yes do it", "continue", and the context-budget prompt, and the
  right session for the specific ones (kill-server, ui-712, the font
  retirement, the rules rundown). One miss: "make the sidebar show fewer
  categories" shares only "sidebar" with `less-cats-in-sidebar`.
- **Auto-adopted and `adopt`ed conversations** (Tier 2.3). A full delivery
  queries with the conversation's last three typed prompts, not only the
  current one, so the adopting prompt also searches with the back-filled
  first prompt. `/bertrand` reaches the same path with no stdin.
- **Framing.** Both blocks call themselves quoted history as of a date, not
  instructions, and say code and git outrank them.
- **Deviation: provenance scope.** The plan said to search only the local
  user's sessions. That can't be enforced per row. Sync swaps the whole
  database (`src/sync/engine.ts`, last push wins) and rows carry no machine
  of origin. Recall therefore relies on the framing, one-line snippets
  capped at 200 characters, and summaries/subjects only.
- **Cost seen so far** (sandboxed copy, force-bertrand-logs): the digest adds
  582 B to a full contract, and one recall pointer adds ~450 B to a
  reminder. Prompts with no match add nothing.

### Tier 3 — measure (decides whether Tier 2 stays)

**A live holdout cannot answer this at bertrand's volume.** Measured
2026-10-05 over 90 conversations: total processed tokens per conversation
(input + cache creation + cache read, already accrued on `conversations` by
ingestion) run from 0.4M to 69M, median 9.2M, with a log-scale SD of 1.10.
For 80% power at α=0.05, a randomized per-conversation holdout needs
**~384 conversations per arm to detect a 20% drop**, ~1,700 for 10% and
~7,300 for 5%. At ~90 conversations a month, even the 20% case takes over
8 months. Task-to-task variance swamps any plausible effect, so this design is
dropped.

What the data supports instead:

1. **Tier 1 needs arithmetic, not an experiment.** Every request re-reads the
   whole context. Conversations make 12–140 requests (four recent bertrand
   conversations), and 91–99% of processed tokens are cache reads. A change
   that removes Δ tokens from the contract therefore saves
   Δ × requests per conversation, and it can be reported exactly from data we
   already have. For a launched conversation, Δ is ~3.4k tokens (the trimmed
   contract plus the removed duplicate). In this session (140 requests,
   22.5M processed) that is ~480k tokens, ~2%. Report it with the cost
   weighting in mind: the saving is almost all cache reads, which are billed
   at a fraction of fresh input.
2. **Tier 2's cost side is also arithmetic.** Log the injected bytes per
   prompt; the cost is injected tokens × the requests that follow. Only the
   *benefit* (exploration avoided) is uncertain.
3. **Tier 2's benefit is measured by paired replay, not live.**
   - **Task set:** ~15–20 prompts mined from history where earlier-session
     context demonstrably mattered. Candidates are the 28 conversations that
     ran `bertrand log|search|list`, and prompts that name another session.
     Pin each to its repo commit.
   - **Arms:** run each task headless twice, identical except for the Tier 2
     injection, on the same model. Pair on task, so the 1.10 log-SD of
     between-task variance cancels. Repeat each pair 2–3 times for
     within-task noise.
   - **Measure:** processed tokens (and cost-weighted tokens) to completion,
     request count, and whether the answer is correct. A cheaper answer that
     is wrong is a loss.
   - **Isolation:** `env -u BERTRAND_*` and `--settings '{"disableAllHooks":true}'`,
     as in the `--resume` probe, so replays never record into bertrand.
   - **Limits:** headless `-p` runs have no AskUserQuestion loop, so tasks
     must be self-contained questions or bounded edits. Replays cost real
     tokens, so budget them before running.
4. **Ship Tier 2 only if** the paired median saving clears its own arithmetic
   cost with no loss in correctness.

**Known noise** (applies to any tool-call proxy): subagent Bash calls are
filed under the parent session, and Bash detail extraction (`scripts.ts:423`)
truncates commands that contain escaped quotes.

---

## Doubt cycle 1 — reviewer findings and verdicts

The reviewer got the first-draft proposal and its constraints only, not the
author's reasoning. The constraints stated the goal as "context should shape
agent behavior". The token goal was clarified afterwards, which explains
verdict #1.

| # | Finding | Verdict |
|---|---|---|
| 1 | UserPromptSubmit misses AUQ-answer turns (367 answers vs 293 prompts), and ~30% of prompts are machine-generated | **Contract misread** on the first half: per-turn injection contradicts the token goal. The machine-prompt filter is **actionable** (Tier 2) |
| 2 | Auto-adopt gate skips the first prompt | **Actionable.** Verified at `scripts.ts:189` (Tier 2.3) |
| 3 | Past instructions injected as live context; synced DBs carry untrusted text | **Actionable** (Tier 2 framing + scope) |
| 4 | "No agent compliance needed" overstated; proposes "inject, then block once until read" | **Trade-off, rejected.** A forced read costs 2–5.6KB (measured digests) and the user ruled out forced logs |
| 5 | bm25: unstable cutoff, MATCH-syntax escaping, near-duplicate corpus, self-match | **Actionable.** Self-match verified at `scripts.ts:488` (Tier 2 ranking) |
| 6 | Repo scoping still fills 12 slots in tabs-backend; loses cross-repo siblings | **Partly noise:** measured 0/12 relevance with global scoping here. Cross-repo loss is an accepted **trade-off** (Tier 1) |
| 7 | Follow-through metric has no holdout and is Goodhart-prone | **Actionable, then superseded:** a holdout turned out to be underpowered at this volume (Tier 3), so Tier 3 uses paired replay instead |
| 8 | A new hook step adds a bun cold start to user-visible latency | **Actionable:** compute inside `bertrand contract` |
| 9 | FTS5 interacts with whole-DB sync snapshots, migrations, triggers | **Trade-off:** avoid FTS5 at the current corpus size |
| 10 | Resume-digest wiring unspecified | **Actionable** (Tier 2.1) |

Cross-model review: offered. Gemini and Codex CLIs are not installed on this
machine. Proceeding with single-model findings only.

## Doubt cycle 2 — review of the de-duplication diff

| # | Finding | Verdict |
|---|---|---|
| 1 | A resumed conversation now depends on `--append-system-prompt` being honored with `--resume` | **Actionable, and confirmed real.** In a headless probe (Claude Code 2.1.289, `-p`, hooks off) an appended codeword reached a fresh session but was ignored on `--resume`, 3 of 3 trials. Fix: write the marker on fresh launches only; resumed conversations keep the hook's copy. Interactive mode was not probed; not marking is safe either way |
| 2 | Nested/background claudes share the parent's `BERTRAND_CLAUDE_ID` and so its marker, so they get the reminder only | **Trade-off, pre-existing:** already true after the parent's first prompt. The hook comment that claimed nested claudes get the full contract is corrected |
| 3 | Writing the marker is a hidden side effect of building argv | **Actionable:** renamed `contractArgs` → `deliverContract`; doc says to call it only on the spawning path |
| 4 | The only full contract is now the launch-time snapshot; siblings can't refresh before the first prompt | **Trade-off:** siblings are now repo-scoped and slow-moving |
| 5 | Test was tautological; no failure-path coverage; temp dir leaked | **Actionable:** covers fresh, resume, and unwritable-runtime-dir; cleans up |
| 6 | `runtime.ts` captures `paths.runtime` at module load, so a future test that drives a real spawn under `_setRootDir` would write into `~/.bertrand/run` | **Trade-off, latent:** no current test reaches a real spawn |
| 7 | Comments still described the hook as the marker's normal writer | **Actionable:** `runtime.ts`, `contract.ts`, `scripts.ts` updated |

## Doubt cycle 3 — review of `/bertrand` delivery, summaries, sibling scoping

| # | Finding | Verdict |
|---|---|---|
| 1 | The hook wrote `contract-sent` even when `bertrand contract` printed nothing (`bq` swallows failures), and `/bertrand` now trusts that marker, so the full contract could never arrive | **Actionable:** the hook marks only a non-empty contract |
| 2 | Re-running `/bertrand` no longer restores a contract `/compact` summarized away | **Trade-off:** `/bertrand` attaches, it doesn't refresh. The marker already meant "delivered once", not "still in context" |
| 3 | A crashed fresh conversation keeps its spawn-time marker; a `--resume` inside the 24h sweep window gets the reminder only | **Trade-off:** session recovery prunes markers at launch and in the server |
| 4 | Nested claudes inherit the parent's marker | **Trade-off,** same as cycle 2 #2 |
| 5 | Re-attaching a finished adopted conversation via `/bertrand` prints a second full copy | **Trade-off:** finalize removes the marker, so this is the old behavior |
| 6 | Healing reached only top-5 siblings; 18 machine-led summaries stayed in `log`/`search` | **Actionable:** `healMachineSummaries()` runs at `bertrand launch`. Adopted-only sessions heal when shown as siblings or on their next pause |
| 7 | `derive-slug.ts` had its own machine-prompt regex that missed `<agent-message from="…">` | **Actionable:** one shared `lib/machine-prompt.ts` (any lowercase tag, attributes allowed) |
| 8 | A current session missing from the non-archived list silently fell back to the global list | **Actionable:** resolved with `getSession` |
| 9 | Siblings on resume are scoped from the session's previous repo/branch (built before `recordSessionKey`) | **Trade-off:** edge case; on a true `--resume` the argv copy is ignored anyway |

## Open, deliberately not answered here

- Whether Tier 2 retrieval saves tokens net of its own cost. Tier 3's paired
  replay is designed to answer it, but has not been built or budgeted.
- Whether the `## Rules` and `## Communicating through a turn` sections can be
  slimmed. Out of scope: they are behavior guidance, not context.
- **The AUQ loop has no "waiting on my own background work" state.** The Stop
  hook blocks any turn that doesn't end in AskUserQuestion, so waiting on a
  subagent forces a redundant question: a round-trip for the user and tokens
  for the session.

## Appendix — reproduce the numbers

```sh
# Contract size and per-section bytes
bertrand contract --session <slug> | wc -c
bertrand contract --session <slug> \
  | awk '/^## /{s=$0} {b[s]+=length($0)+1} END{for(k in b) print b[k], k}' | sort -rn
bertrand contract --session <slug> --short | wc -c

# Digest sizes
bertrand log <slug> | wc -c

# Sibling repo mix (what the contract would inject)
sqlite3 -readonly ~/.bertrand/bertrand.db \
  "select slug, repo from sessions where status!='archived' and slug!='<slug>'
   order by updated_at desc limit 12;"

# Conversations that consulted bertrand, and how early
sqlite3 -readonly ~/.bertrand/bertrand.db "
with t as (select conversation_id, json_extract(meta,'$.detail') d,
             row_number() over (partition by conversation_id order by id) n
           from events where event='tool.used'),
     hits as (select conversation_id, min(n) first_n from t
              where d like '%bertrand log%' or d like '%bertrand search%'
                 or d like '%bertrand list%' or d like '%bertrand stats%'
              group by conversation_id)
select (select count(distinct conversation_id) from t),
       (select count(*) from hits),
       (select count(*) from hits where first_n<=5);"
```
