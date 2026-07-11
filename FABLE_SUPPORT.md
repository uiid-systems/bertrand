# Supporting Claude Fable in bertrand sessions

> A working doc for fixing the "silent Fable" problem in bertrand's forced-AskUserQuestion
> workflow, written from inside an affected session (design-system, timeline/more-ui-enhancements,
> 2026-07-10). Move this into the bertrand repo when acting on it.

## The problem

In bertrand sessions running Claude Fable, the user sees almost none of the model's prose —
just tool activity and then an AskUserQuestion menu with no context. With Opus the same
setup works fine. The forced-AUQ loop itself is load-bearing (it's an intentional
ADHD-focus mechanism) and must not be weakened; the fix has to be about *delivery* of the
model's narration, not about relaxing the loop.

## Diagnosis

Fable was narrating the whole time — long findings summaries, full proposals, trade-off
discussions. What differs from Opus is *where that text sits in the message stream*:

1. **Thinking is not rendered.** Opus's visible reasoning gives a running commentary in the
   terminal. Fable's extended thinking happens in blocks the terminal doesn't display, so
   the ambient "I can see it working" signal is gone. Nothing to fix here — it's a
   model/harness property — but it removes the safety net that masks problem #2.

2. **Response text attached to tool calls doesn't reliably reach the user.** Fable
   interleaves its prose with tool calls inside a turn, and — because bertrand's hook
   requires every turn to end with AskUserQuestion — every turn terminates in a question
   dialog rather than in plain final text. Empirically, in this session:
   - A turn that ended with **plain text and no AUQ** (a hook violation) rendered
     perfectly — the user read the full ~800-word proposal.
   - Turns where the same kind of prose sat **before an AskUserQuestion call** (same
     message or same turn) showed the user only the dialog.
   - Mid-turn text blocks **between tool calls** were also reported unseen ("I am not
     seeing any of your conversations, summaries, etc."), even after separating prose
     from the AUQ call with buffer tool calls — so "just add a tool call between text
     and AUQ" is NOT a sufficient fix.

   Net effect: under a forced-AUQ regime, Fable has *no* reliable in-conversation channel
   for substantive prose. Opus dodges this mostly by emitting shorter turns and separate
   text messages, plus its visible thinking.

   It's worth a controlled reproduction (one scratch session, one long text block, one
   AUQ) to pin down whether the dropping happens in Claude Code's TUI rendering or in
   bertrand's wrapping. If it reproduces with bertrand out of the loop, file it upstream
   against Claude Code.

## Fixes, in layers

### Layer 1 — session-rule patch (do this first; model-agnostic; ~5 lines)

bertrand already injects session rules via the UserPromptSubmit hook context. Add a
delivery rule alongside the existing AUQ rules:

```
Substantive narration (findings, proposals, summaries, anything the user must read)
must be delivered where it is guaranteed to render:
  - append it to the session notes file at the repo root (create it if absent:
    CONVERSATION.md, with a header explaining it is the session narration channel), and
  - keep the text immediately preceding the AskUserQuestion call to a single short
    sentence that points at that file (e.g. "Details in CONVERSATION.md — pick an option").
Option labels/descriptions in AskUserQuestion must be self-sufficient for choosing,
but must never be the only place a proposal exists.
```

Opus ignores the file channel at no cost (its text renders anyway, and the file is
harmless); Fable gains a guaranteed channel. The user reads one file instead of scrollback.

### Layer 2 — PreToolUse enforcement (self-healing, catches regressions)

The existing PreToolUse hook on AskUserQuestion (the multiSelect enforcer,
`~/.bertrand/hooks/on-waiting.sh`) receives `transcript_path` in its stdin payload. Extend it:

1. Parse the in-flight assistant message from the transcript tail.
2. If the message carrying the AskUserQuestion tool_use also contains text blocks over
   ~300 characters, **deny** with feedback like:
   > "Long narration attached to AskUserQuestion will not render. Write it to
   > CONVERSATION.md at the repo root, then re-issue the question with a one-line lead-in."
3. Cache a marker (e.g. hash of the denied text) so the retry isn't re-denied for
   *mentioning* the file.

Caveat to test: whether a denied AUQ causes the already-streamed text to duplicate on
retry. If it does, prefer Layer 1 + Layer 3 and use Layer 2 only as a warning (exit 0
with stderr feedback) rather than a hard deny.

### Layer 3 — surface assistant text in bertrand itself (belt and suspenders)

bertrand already ingests `assistant.message` events into the session timeline. Two options,
cheapest first:

- **`bertrand last` / TUI pane**: a command or panel that prints the most recent
  assistant message for the active session. When a question dialog appears context-free,
  the user runs one command to see what preceded it.
- **Dashboard pairing**: in the session view, render the pending question alongside the
  last assistant message so the Q&A record is always complete — this also improves the
  replay/archive value of sessions regardless of the Fable issue.

### Layer 4 — upstream

If the scratch reproduction shows Claude Code's TUI dropping non-final text blocks (or
text preceding AskUserQuestion) for models with interleaved thinking, file it against
Claude Code with the repro. That's the real fix; layers 1–3 are insurance that also
harden bertrand against any future model with the same emission pattern.

## What the model side already does (this project)

Claude's project memory for design-system now pins: narrate before asking, never let
prose ride against an AUQ call, and use a root `CONVERSATION.md` as the narration channel
in bertrand+Fable sessions. So sessions in this repo behave correctly even before any
bertrand changes ship. Porting that behavior to other projects is exactly what Layer 1
automates.

## Hard evidence: the text never reaches the transcript (2026-07-11)

The controlled reproduction the Diagnosis section asked for happened by accident, from
inside session `timeline/fix-assistant-card` (claude-fable-5), by inspecting that
session's own transcript JSONL mid-conversation. The answer to "TUI rendering or
bertrand's wrapping?" is **neither**: the text blocks are missing from
`~/.claude/projects/<project>/<uuid>.jsonl` itself. No downstream consumer — TUI,
bertrand ingestion, `claude --resume` — can ever recover them.

The signature, from one measured turn (~10 narration messages written, 3 survived):

- **Survives** — response emitted as `thinking → text → tool_use`, i.e. the prose sits
  immediately before the tool call. Transcript records all three blocks.
- **Destroyed** — response emitted as `thinking → text → thinking → tool_use`, i.e. the
  model narrates and then thinks again before choosing tool parameters (Fable's normal
  interleaved-thinking pattern for non-trivial calls). Transcript records
  `thinking, thinking, tool_use` — the text block between the two thinking blocks is
  simply absent. Same request id, monotonic timestamps, no gap entry.

Grouping the transcript's assistant entries by `requestId` makes the pattern obvious:
every request known to have carried narration that never surfaced shows two thinking
entries and no text entry. This also explains why Opus sessions look mostly fine —
Opus thinks once at the start of a response, so its prose is never sandwiched between
thinking blocks.

Consequences for the layered fixes above:

- Layer 2's transcript-tail check can't catch this — the denied evidence never lands in
  the transcript to begin with. Only its AUQ-adjacent case remains useful.
- Layer 3 (surfacing captured text in bertrand) is still worth it, but it can only
  surface the ~30% that survives.
- Layer 1 (file-based narration channel) is the only complete mitigation until the
  upstream fix ships, because Write/Edit tool calls persist their payload regardless.

### Upstream report draft (Layer 4, ready to file against Claude Code)

> **Title:** Assistant text blocks followed by interleaved thinking are dropped from the
> session transcript (claude-fable-5)
>
> **Environment:** Claude Code CLI, model `claude-fable-5`, macOS. Observed in every
> turn with interleaved thinking; reproduction rate ~70% of mid-turn text blocks in
> tool-heavy turns.
>
> **Repro:** Run a tool-heavy task that makes the model narrate between tool calls
> (easily forced with a PreToolUse-hooked AskUserQuestion loop, but not specific to it).
> After the turn, group the transcript JSONL's `type:"assistant"` entries by
> `requestId` and compare against what the model emitted.
>
> **Expected:** every content block of the API response appears as a transcript entry:
> `thinking, text, thinking, tool_use`.
>
> **Actual:** `thinking, thinking, tool_use` — the text block that was followed by
> another thinking block in the same response is not written (and is not rendered in
> the TUI either). Text blocks emitted directly before `tool_use` with no intervening
> thinking block are persisted and rendered normally.
>
> **Impact:** the model's narration is unrecoverable — not in the terminal, not in the
> transcript, not on resume. Any tooling that audits or replays transcripts sees a
> model that silently calls tools without explanation.
