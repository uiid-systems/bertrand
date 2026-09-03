/**
 * Bash hook script templates.
 *
 * Architecture: Claude Code hooks → bash scripts → `${BIN} update` → SQLite
 * Identity comes from the payload's `session_id`, with BERTRAND_SESSION /
 * BERTRAND_CLAUDE_ID as the launched-path override (see sessionGuard).
 *
 * Two stderr channels by design:
 *   - `bq <subcommand>` runs the bertrand binary with stderr discarded and
 *     exit code clamped to 0 — internal panics (SQLite races, bun stack
 *     traces, etc.) never leak into Claude's transcript.
 *   - `printf … >&2; exit 2` blocks the tool call and surfaces the message
 *     to Claude. That's the deliberate bertrand → agent signal channel
 *     (e.g. the multiSelect:true enforcement in on-waiting.sh).
 *
 * Performance notes:
 *   - grep/sed used instead of jq for simple field extraction (~1ms vs ~15ms)
 *   - jq -n kept for building meta JSON (safe escaping, acceptable cost)
 *   - permissionDoneScript folds diff extraction into the existing jq invocation
 *     so adding old_str/new_str capture costs nothing extra
 *   - the session guard reads the payload with a bounded `read` builtin, so
 *     resolving identity costs no fork and no time proportional to payload size
 *   - activeScript has a debounce guard to skip redundant updates
 */

/** Extract a JSON string field via grep — ~1ms vs jq's ~15ms */
const EXTRACT_TOOL = `tool="$(printf '%s' "$input" | grep -o '"tool_name":"[^"]*"' | cut -d'"' -f4)"`;

/**
 * Pull the head of the hook payload off stdin with a bash builtin.
 *
 * Identity lives in the payload's `session_id`, and the payload is the only
 * interface Claude Code documents — so that, not an env var, is what the guard
 * below keys off. Reading it has to stay free: every claude on the machine
 * fires these hooks and almost none of them are ours.
 *
 * Hence a bounded builtin read rather than `input="$(cat)"`. `session_id` is
 * the payload's first field (measured 2026-08-31 across six concurrent claude
 * sessions — session_id, transcript_path, cwd, prompt_id, permission_mode,
 * effort, hook_event_name, tool_name, tool_input, tool_response, tool_use_id,
 * duration_ms), so 512 bytes is ~9x the room it needs and the cost is flat in
 * payload size — which is the property that matters. Paired per-invocation runs
 * of the rendered scripts, 200 pairs per cell: +0.17 ms/hook on the no-op path
 * at 3 KB and +0.21 ms at 120 KB, against +7.7 ms for `$(cat)` piped through
 * grep at 120 KB. On the resolved path the difference is not measurable.
 *
 * The match is on `"session_id":` and then the quotes around the value, rather
 * than on the whole `"session_id":"` in one step, so whitespace after the colon
 * parses too — Claude emits compact JSON today, and a value we cannot parse
 * falls through to the env var rather than to silence either way.
 *
 * `-n 512`, not `-N 512`: `-N` is bash 4.1+ and /bin/bash on macOS is 3.2.
 * `-d ''` makes NUL the delimiter so a newline can never end the read early,
 * and `IFS=` keeps leading whitespace. Verified on bash 3.2.57 and 5.3.3.
 */
const READ_PAYLOAD_HEAD = `IFS= read -r -d '' -n 512 phead`;

/**
 * The rest of the payload, appended to the head the guard already consumed.
 * Every script that parses `$input` must use this instead of `$(cat)`, which
 * alone would silently drop the first 512 bytes — including `cwd` and
 * `transcript_path`, which live in them. Byte-identical to the old
 * `input="$(cat)"` otherwise — both drop trailing newlines.
 *
 * Two callers read conditionally rather than unconditionally: the auto-create
 * rung consumes stdin inside the guard, so `userPromptScript` reads only when
 * the guard left `$input` empty.
 */
const READ_PAYLOAD_REST = `input="$phead$(cat)"`;

/**
 * Session resolution — the first thing every hook does, and the only thing
 * most of them ever do.
 *
 * `BERTRAND_SESSION` is exported by bertrand's own claude spawn, so its
 * presence means this claude is launched-and-tracked. It wins outright.
 *
 * Otherwise identity is the payload's `session_id` — claude's own session id,
 * which is what `bertrand adopt` (ELKY-179) keyed both its marker and its
 * conversation row on. Adoption cannot export anything into an already-running
 * claude — hook subprocesses inherit claude's spawn-time environment — so the
 * marker is the whole lookup: a path built from the payload id and one `[ -f ]`
 * test. No fork, no jq, and a cost that does not grow with the payload — which
 * is what the path that matters needs, that being the no-op path.
 *
 * `CLAUDE_CODE_SESSION_ID` stays as a fallback rather than the source. Claude
 * injects it per hook spawn — it is absent from claude's own process env — and
 * it matched the payload in all six concurrent sessions measured on
 * 2026-08-31. But it is undocumented, where `session_id` is part of the
 * published hook schema, so it belongs behind the payload rather than in front
 * of it. Keeping it means a payload we cannot parse degrades to exactly the
 * previous behaviour instead of to silence.
 *
 * A nested `"session_id"` cannot hijack this. Payload strings arrive escaped
 * (`\"session_id\":\"…`), so a tool_input that happens to contain the literal
 * text — this file's own tests do — never matches the unescaped pattern, and
 * the 512-byte window keeps the search in the header regardless. That closes
 * the greedy-match caveat ELKY-173 left open.
 *
 * The marker carries the project as well as the session because an adopted
 * claude never inherited `BERTRAND_PROJECT` either. Without exporting it, the
 * bin would write into whichever project happens to be active in the registry
 * when the hook fires, which has no relation to the session it just resolved.
 *
 * Defines `sid` and `cid` for the rest of the script. On an adopted session
 * the conversation id *is* claude's session id — that is what `adopt` keyed
 * the conversation row on.
 *
 * `autoCreate` adds a third rung to the ladder for the one hook that may
 * create a session rather than only resolve one — see {@link autoCreateGate}.
 * That rung consumes stdin, so a script passing it must read `$input` only if
 * the guard left it empty.
 */
function sessionGuard(
  runtimeDir: string,
  opts: { autoCreate?: boolean } = {},
): string {
  const noMarker = opts.autoCreate
    ? autoCreateGate(runtimeDir)
    : `  [ -f "$adopted" ] || exit 0`;
  return `sid="\${BERTRAND_SESSION:-}"
cid="\${BERTRAND_CLAUDE_ID:-}"
${READ_PAYLOAD_HEAD}
if [ -z "$sid" ]; then
  ccid="\${phead#*\\"session_id\\":}"
  if [ "$ccid" = "$phead" ]; then
    ccid=""
  else
    # Split on the key, then on the quotes around the value, so an encoder that
    # pads after the colon parses the same as Claude's own compact JSON.
    ccid="\${ccid#*\\"}"
    ccid="\${ccid%%\\"*}"
  fi
  # No id in the payload, or one that could escape the runtime dir, falls back
  # to the env var: degrade to the pre-payload behaviour, never to silence.
  case "$ccid" in ""|*/*) ccid="\${CLAUDE_CODE_SESSION_ID:-}" ;; esac
  [ -z "$ccid" ] && exit 0
  adopted="${runtimeDir}/adopted-$ccid"
${noMarker}
  while IFS='=' read -r k v || [ -n "$k" ]; do
    case "$k" in
      session) sid="$v" ;;
      project) BERTRAND_PROJECT="$v" ;;
    esac
  done < "$adopted"
  [ -z "$sid" ] && exit 0
  [ -n "\${BERTRAND_PROJECT:-}" ] && export BERTRAND_PROJECT
  cid="$ccid"
fi`;
}

/**
 * Auto-create a session for an unseen claude session id (ELKY-175).
 *
 * This runs in place of the guard's `exit 0` for an unadopted conversation,
 * and it is the *only* place bertrand records a claude it neither launched nor
 * was explicitly pointed at. Three things keep it from being the noisy
 * always-on capture `docs/session-identity.md` argues against:
 *
 * **It is on UserPromptSubmit alone.** Not the four hot hooks — a claude that
 * is not ours must keep costing nothing on the path that fires dozens of times
 * a turn. And a user prompt is a signal no subagent can produce, which retires
 * the doc's open question about auto-creation minting a session per Task call.
 *
 * **It waits for the second prompt.** `$gate` absent means this conversation
 * has said nothing yet; the hook creates it empty and returns. A conversation
 * that ends after one prompt therefore leaves a row nowhere. That is the
 * materiality gate, and it costs two bash builtins. Nothing is lost by
 * waiting: the back-fill is cursor-based and imports the earlier turns at
 * creation time.
 *
 * **A decline is remembered.** `bertrand auto-adopt` writes the reason into
 * `$gate` when the answer will not change — the directory belongs to no
 * project, or its project has not opted in — and `[ -s ]` short-circuits every
 * later prompt before anything is spawned. A directory nobody registered
 * therefore pays for exactly one bin invocation per conversation, and every
 * prompt after it costs a file test.
 *
 * `cwd` comes from the payload rather than `$PWD`. They agree today, but the
 * payload is the value Claude Code documents, and picking the wrong project is
 * a silent failure — the session lands in another project's log and nothing
 * says so.
 */
function autoCreateGate(runtimeDir: string): string {
  return `  if [ ! -f "$adopted" ]; then
    gate="${runtimeDir}/autocreate-$ccid"
    # Non-empty: auto-adopt already declined for good. Empty: one prompt seen.
    [ -s "$gate" ] && exit 0
    if [ ! -f "$gate" ]; then : > "$gate"; exit 0; fi
    # Read here rather than at the top of the script, so a claude that is not
    # eligible exits above without paying for it. The body reuses this.
    # "$phead" is the head the guard already consumed off stdin; without it
    # both extractions below come back empty, since cwd and transcript_path
    # sit in the first 512 bytes.
    ${READ_PAYLOAD_REST}
    bq auto-adopt --claude-id "$ccid" \\
      --cwd "$(printf '%s' "$input" | grep -o '"cwd":"[^"]*"' | head -1 | cut -d'"' -f4)" \\
      --transcript-path "$(printf '%s' "$input" | grep -o '"transcript_path":"[^"]*"' | head -1 | cut -d'"' -f4)" \\
      >/dev/null
    # Declined, or failed transiently. Either way there is no session to write
    # to; a transient failure left $gate empty and the next prompt retries.
    [ -f "$adopted" ] || exit 0
  fi`;
}

/**
 * Quiet-bertrand helper. Every hook prepends this so all `bq <subcommand>` calls
 * route stderr to /dev/null and never exit non-zero. Internal failures (DB
 * locks, schema races, bun panics) stay invisible to Claude. Deliberate
 * signals MUST use bash-level `printf >&2; exit 2` instead.
 */
function quietHelper(bin: string): string {
  return `bq() { ${bin} "$@" 2>/dev/null || true; }`;
}

/** PreToolUse AskUserQuestion → enforce multiSelect:true, then mark session as waiting */
export function waitingScript(bin: string, runtimeDir: string): string {
  return `#!/usr/bin/env bash
# Hook: PreToolUse AskUserQuestion → enforce multiSelect, mark session as waiting
${quietHelper(bin)}
${sessionGuard(runtimeDir)}

${READ_PAYLOAD_REST}

# Block AUQ calls that omit multiSelect:true on any question. multiSelect is a
# UX-safety mechanism in bertrand (prevents submit-on-focus), not a cardinality
# signal. Enforce mechanically so the rule sticks in subagent / job contexts
# where the system-prompt contract never reaches the agent.
if printf '%s' "$input" | jq -e '.tool_input.questions[]? | select(.multiSelect != true)' > /dev/null 2>&1; then
  printf 'All AskUserQuestion questions must set multiSelect:true. This is a UX-safety mechanism in bertrand (prevents submit-on-focus when the question block gains focus), not a cardinality signal. Retry with multiSelect:true on every question.\\n' >&2
  exit 2
fi


# Extract question — grep for simple field extraction (~1ms vs jq ~15ms)
question="$(printf '%s' "$input" | grep -o '"question":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-2000)"
[ -z "$question" ] && question="Waiting for input"

# Clear working debounce marker so next resume→working transition fires
rm -f "${runtimeDir}/working-$sid"

# The transcript path rides along so update ingests the turn's assistant
# output (narration + trailing thinking, hence --flush) before inserting the
# waiting event — cards land in true order. An empty path is ignored by the
# update flag parser.
tpath="$(printf '%s' "$input" | grep -o '"transcript_path":"[^"]*"' | cut -d'"' -f4)"

bq update --session-id "$sid" --event session.waiting --meta "$(jq -n --arg q "$question" --arg cid "$cid" '{question:$q, claude_id:$cid}')" --transcript-path "$tpath" --flush
`;
}

/** PostToolUse AskUserQuestion → mark session as active (user answered) */
export function answeredScript(bin: string, runtimeDir: string): string {
  return `#!/usr/bin/env bash
# Hook: PostToolUse AskUserQuestion → mark session as active
#
# If the user's answer contains "Done for now", emit {"continue": false} to
# Claude Code so the agent halts immediately instead of taking another turn.
# This is the mechanical enforcement of the contract's loop-exit rule — the
# contract prose is a soft hint, this JSON is the guarantee.
${quietHelper(bin)}
${sessionGuard(runtimeDir)}

${READ_PAYLOAD_REST}

# Capture the full AskUserQuestion payload so the UI can render picked vs
# unpicked options alongside the user's answer. tool_input.questions carries
# the question definitions (label/description/multiSelect) the agent passed.
meta="$(printf '%s' "$input" | jq --arg cid "$cid" '
  {
    answers: ((.tool_input.answers // .tool_response.answers) // {}),
    annotations: ((.tool_input.annotations // .tool_response.annotations) // {}),
    questions: (.tool_input.questions // []),
    claude_id: $cid
  }
' 2>/dev/null)"

# Concatenate all answer values into a single string for the Done-for-now check.
done_check="$(printf '%s' "$meta" | jq -r '.answers | to_entries | map(.value | tostring) | join(" ")' 2>/dev/null)"

bq update --session-id "$sid" --event session.answered --meta "$meta"

# The loop is healthy — the agent ended its turn on AskUserQuestion and the
# user answered. Reset the Stop-hook nudge counter so its cap applies per
# run of consecutive contract violations, not cumulatively across the session.
rm -f "${runtimeDir}/auq-nudge-$sid"

# Halt the agent loop if the user signaled Done for now. The Stop hook
# (on-done.sh) will fire afterwards and mark the session as paused.
if printf '%s' "$done_check" | grep -q "Done for now"; then
  # Tell on-done.sh this Stop is a legitimate exit, not a dropped AUQ call —
  # so it pauses normally instead of forcing the loop to continue.
  touch "${runtimeDir}/done-$sid"

  printf '{"continue": false, "stopReason": "User selected Done for now"}\\n'
fi
`;
}

/** PermissionRequest → write pending marker so PostToolUse can tag tool.used as approved */
export function permissionWaitScript(bin: string, runtimeDir: string): string {
  return `#!/usr/bin/env bash
# Hook: PermissionRequest → mark pending, flip session to blocked
${quietHelper(bin)}
${sessionGuard(runtimeDir)}

${READ_PAYLOAD_REST}
${EXTRACT_TOOL}
[ "$tool" = "AskUserQuestion" ] && exit 0

# Marker tells the PostToolUse hook to emit tool.used with outcome:approved
# instead of outcome:auto. Without it, every prompted-then-approved tool call
# would look identical to an auto-approved one.
touch "${runtimeDir}/perm-pending-$sid"

# Flip the session to \`blocked\` so the sidebar shows the distinct
# permission-request state (orange) instead of looking like Claude is still
# working. on-permission-done.sh flips it back to active once the approved
# tool runs.
bq update --session-id "$sid" --event session.blocked
`;
}

/** PostToolUse (catch-all) → capture every tool call */
export function permissionDoneScript(bin: string, runtimeDir: string): string {
  return `#!/usr/bin/env bash
# Hook: PostToolUse (catch-all)
#
# Captures every tool call Claude makes. Two event flows:
#   1. Edit/Write/MultiEdit → tool.applied with diff payload. Keeps the
#      existing dashboard diff-renderer happy and is the only place we get
#      old_string/new_string on auto-approved edits.
#   2. Everything else → tool.used. The PermissionRequest hook may have set
#      a marker; if so the call was prompted-then-approved (outcome:approved),
#      otherwise it was auto-approved (outcome:auto). Denials never reach
#      PostToolUse, so absence of a tool.used after a permission.request means
#      the user said no.
${quietHelper(bin)}
${sessionGuard(runtimeDir)}

${READ_PAYLOAD_REST}
${EXTRACT_TOOL}

# Don't double-log: AskUserQuestion has its own waiting/answered events.
case "$tool" in AskUserQuestion) exit 0 ;; esac

# Transcript path rides along on the update calls below: the command ingests
# any new assistant output (the narration that preceded this tool call)
# before inserting the tool event, keeping the timeline in true order.
tpath="$(printf '%s' "$input" | grep -o '"transcript_path":"[^"]*"' | cut -d'"' -f4)"

marker="${runtimeDir}/perm-pending-$sid"
had_marker=0
if [ -f "$marker" ]; then
  had_marker=1
  rm -f "$marker"
  # Approved tool is now running → clear the blocked state back to active.
  # No-op if the session already moved on (update dedupes same-status flips).
  bq update --session-id "$sid" --event session.active &
fi


case "$tool" in
  Edit|Write|MultiEdit)
    detail="$(printf '%s' "$input" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-1000)"
    case "$tool" in
      Write) summary="wrote a file" ;;
      *) summary="edited a file" ;;
    esac
    meta="$(printf '%s' "$input" | jq --arg t "$tool" --arg d "$detail" --arg cid "$cid" '
      {
        permissions: [
          {tool:$t, detail:$d, outcome:"applied", count:1}
          + (.tool_input.old_string | if type == "string" and . != "" then {oldStr: .[:4096]} else {} end)
          + ((.tool_input.new_string // .tool_input.content) | if type == "string" and . != "" then {newStr: .[:4096]} else {} end)
          + (.tool_input.edits | if type == "array" and length > 0 then {edits: [.[] | {oldStr: ((.old_string // "")[:4096]), newStr: ((.new_string // "")[:4096])}]} else {} end)
        ],
        outcome: "applied",
        claude_id: $cid
      }
    ')"
    bq update --session-id "$sid" --event tool.applied --summary "$summary" --meta "$meta" --transcript-path "$tpath"
    wait
    exit 0
    ;;
esac

# Extract a tool-shaped detail for the timeline summary. Bash gets the
# command, file tools get the path; everything else falls back to a generic
# label inside the emit helper.
detail=""
case "$tool" in
  Bash) detail="$(printf '%s' "$input" | grep -o '"command":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-1000)" ;;
  Read|NotebookRead) detail="$(printf '%s' "$input" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-1000)" ;;
  Glob) detail="$(printf '%s' "$input" | grep -o '"pattern":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-200)" ;;
  Grep) detail="$(printf '%s' "$input" | grep -o '"pattern":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-200)" ;;
  WebFetch) detail="$(printf '%s' "$input" | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-300)" ;;
  WebSearch) detail="$(printf '%s' "$input" | grep -o '"query":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-200)" ;;
esac

outcome="auto"
[ "$had_marker" = "1" ] && outcome="approved"
bq update --session-id "$sid" --event tool.used --meta "$(jq -n --arg t "$tool" --arg d "$detail" --arg o "$outcome" --arg cid "$cid" '{tool:$t, detail:$d, outcome:$o, claude_id:$cid}')" --transcript-path "$tpath"
wait
`;
}

/**
 * UserPromptSubmit → record user free-text prompt as user.prompt event.
 * Fires once per user turn (not hot-path), so jq for safe multi-line/escape
 * handling is fine — grep would mangle prompts containing quotes or newlines.
 *
 * The one hook whose guard may *create* a session rather than only resolve
 * one, because a user prompt is the cheapest honest signal that a
 * conversation is real work: it is rare enough to spend a process on, and no
 * subagent can produce one. See {@link autoCreateGate}.
 */
export function userPromptScript(bin: string, runtimeDir: string): string {
  return `#!/usr/bin/env bash
# Hook: UserPromptSubmit → record user prompt + re-inject the session contract.
#
# The contract normally arrives via --append-system-prompt on bertrand's own
# claude spawn, which reaches only that one process. Sessions that inherit the
# BERTRAND_* env vars without going through launchClaude (background jobs,
# nested \`claude\`, an external launcher) never receive it. Re-
# injecting here — through the durable env/hook channel — closes that gap.
# Full contract on the first prompt of each conversation, a one-line reminder
# thereafter, to keep the per-turn token cost low.
${quietHelper(bin)}
${sessionGuard(runtimeDir, { autoCreate: true })}

# Already set when the guard's auto-create rung read it; still empty on every
# other path, including the launched one this hook was originally written for.
[ -z "$input" ] && ${READ_PAYLOAD_REST}

# Bring the shared dashboard server up if it isn't already. This is the one
# lifecycle event every launch path shares, so it is the only place that covers
# the TUI, \`bertrand adopt\`, the /bertrand command and a bare \`claude\` alike —
# server start used to live in the TUI launcher, which meant an adopted session
# never got one. Costs a single kill(pid,0) when a server is already healthy,
# and never waits for readiness, so a cold start cannot stall the turn.
# Stdout muted: UserPromptSubmit parses stdout as a hook decision.
bq ensure-server >/dev/null

# Record the prompt event. Stdout muted so only the context JSON below reaches
# the hook's stdout (UserPromptSubmit parses stdout as a hook decision).
meta="$(printf '%s' "$input" | jq --arg cid "$cid" '{prompt: (.prompt // ""), claude_id: $cid}')"
[ -n "$meta" ] && bq update --session-id "$sid" --event user.prompt --meta "$meta" >/dev/null

# Re-deliver the contract as additional context.
marker="${runtimeDir}/contract-sent-\${cid:-$sid}"
if [ -f "$marker" ]; then
  contract="$(bq contract --session-id "$sid" --short)"
else
  contract="$(bq contract --session-id "$sid")"
  : > "$marker"
fi

[ -n "$contract" ] && jq -n --arg c "$contract" \
  '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $c}}'
`;
}

/**
 * Stop hook → enforce the AskUserQuestion loop, then flip session to paused.
 *
 * Stop fires exactly when the agent ends a turn with no pending tool call —
 * i.e. it answered with text instead of ending on AskUserQuestion. A turn that
 * *does* end on AskUserQuestion leaves a pending tool use, so the agent isn't
 * "stopping" and this hook never fires. Therefore a Stop that is not a
 * Done-for-now exit means the agent dropped the every-turn-ends-with-AUQ
 * contract — so we block it and force the loop to continue. This is the
 * mechanical guarantee that mirrors the multiSelect enforcement in
 * on-waiting.sh, and it works in any context the system-prompt contract can't
 * reach (background jobs, nested claude, an external launcher).
 */
export function doneScript(bin: string, runtimeDir: string): string {
  return `#!/usr/bin/env bash
# Hook: Stop → enforce AUQ loop, else flip session status to paused.
${quietHelper(bin)}
${sessionGuard(runtimeDir)}

${READ_PAYLOAD_REST}

done_marker="${runtimeDir}/done-$sid"
nudge_marker="${runtimeDir}/auq-nudge-$sid"

# Ingest the turn's remaining assistant output either way (--flush emits any
# trailing thinking-only block). Stdout is muted so it can never corrupt a
# decision-JSON payload. The ingest cursor makes this idempotent vs the
# AskUQ-time tick — a Done-for-now exit lands zero new events; a dropped-AUQ
# Stop records the stray turn.
tpath="$(printf '%s' "$input" | grep -o '"transcript_path":"[^"]*"' | cut -d'"' -f4)"
if [ -n "$tpath" ]; then
  bq ingest-transcript --session-id "$sid" --transcript-path "$tpath" --conversation-id "$cid" --flush >/dev/null &
fi

if [ ! -f "$done_marker" ]; then
  # Not a Done-for-now exit → the turn ended without AskUserQuestion. Force the
  # loop to continue, up to a small cap so a context where AUQ is genuinely
  # unavailable can't wedge the session in an endless block/stop cycle. The
  # counter is reset on every answered AUQ (on-answered.sh), so the cap bounds
  # consecutive violations, not the whole session.
  count="$(cat "$nudge_marker" 2>/dev/null)"
  case "$count" in ''|*[!0-9]*) count=0 ;; esac
  if [ "$count" -lt 3 ]; then
    printf '%s' "$((count + 1))" > "$nudge_marker"
    reason='This is a bertrand session: every turn must end with an AskUserQuestion call (multiSelect:true on every question) that includes a "Done for now" option. You ended a turn without calling AskUserQuestion. Call it now to continue the loop, or — if the work is finished — present it so the user can pick "Done for now" to end the session.'
    wait
    jq -n --arg r "$reason" '{decision:"block", reason:$r}'
    exit 0
  fi
  # Cap reached — stop nudging and let the session pause normally.
fi

# Terminal path: legitimate Done-for-now exit, or nudge cap exhausted. Let the
# ingest finish first so the final assistant events precede the paused flip.
rm -f "$done_marker" "$nudge_marker"
wait
bq update --session-id "$sid" --event session.paused
`;
}

export const HOOK_SCRIPTS = {
  "on-waiting.sh": waitingScript,
  "on-answered.sh": answeredScript,
  "on-permission-wait.sh": permissionWaitScript,
  "on-permission-done.sh": permissionDoneScript,
  "on-user-prompt.sh": userPromptScript,
  "on-done.sh": doneScript,
} as const;
