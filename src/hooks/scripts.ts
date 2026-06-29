/**
 * Bash hook script templates.
 *
 * Architecture: Claude Code hooks → bash scripts → `${BIN} update` → SQLite
 * Terminal integration via `${BIN} badge` / `${BIN} notify` (adapter-based).
 * The hooks read BERTRAND_SESSION (session ID) and BERTRAND_CLAUDE_ID from env.
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
 *   - badge/notify backgrounded where possible (terminal UI doesn't need to block Claude)
 *   - activeScript has a debounce guard to skip redundant updates
 */

/** Extract a JSON string field via grep — ~1ms vs jq's ~15ms */
const EXTRACT_TOOL = `tool="$(printf '%s' "$input" | grep -o '"tool_name":"[^"]*"' | cut -d'"' -f4)"`;

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
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"

# Block AUQ calls that omit multiSelect:true on any question. multiSelect is a
# UX-safety mechanism in bertrand (prevents submit-on-focus), not a cardinality
# signal. Enforce mechanically so the rule sticks in subagent / job contexts
# where the system-prompt contract never reaches the agent.
if printf '%s' "$input" | jq -e '.tool_input.questions[]? | select(.multiSelect != true)' > /dev/null 2>&1; then
  printf 'All AskUserQuestion questions must set multiSelect:true. This is a UX-safety mechanism in bertrand (prevents submit-on-focus when the question block gains focus), not a cardinality signal. Retry with multiSelect:true on every question.\\n' >&2
  exit 2
fi

cid="\${BERTRAND_CLAUDE_ID:-}"

# Extract question — grep for simple field extraction (~1ms vs jq ~15ms)
question="$(printf '%s' "$input" | grep -o '"question":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-2000)"
[ -z "$question" ] && question="Waiting for input"

# Clear working debounce marker so next resume→working transition fires
rm -f "${runtimeDir}/working-$sid"

bq update --session-id "$sid" --event session.waiting --meta "$(jq -n --arg q "$question" --arg cid "$cid" '{question:$q, claude_id:$cid}')"

# Capture the latest assistant turn's text. Dedup inside the
# command makes it idempotent vs the matching Stop-time capture so the same
# turn never lands twice.
tpath="$(printf '%s' "$input" | grep -o '"transcript_path":"[^"]*"' | cut -d'"' -f4)"
if [ -n "$tpath" ]; then
  bq assistant-message --session-id "$sid" --transcript-path "$tpath" --conversation-id "$cid" &
fi

# Badge + notify in background — terminal UI doesn't need to block Claude
bq badge message-question --color '#e0b956' --priority 20 --beep &
bq notify bertrand "$question" &
wait
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
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
cid="\${BERTRAND_CLAUDE_ID:-}"

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

bq badge --clear &

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

wait
`;
}

/** PermissionRequest → write pending marker so PostToolUse can tag tool.used as approved */
export function permissionWaitScript(bin: string, runtimeDir: string): string {
  return `#!/usr/bin/env bash
# Hook: PermissionRequest → mark pending, badge + notify
${quietHelper(bin)}
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
${EXTRACT_TOOL}
[ "$tool" = "AskUserQuestion" ] && exit 0

# Marker tells the PostToolUse hook to emit tool.used with outcome:approved
# instead of outcome:auto. Without it, every prompted-then-approved tool call
# would look identical to an auto-approved one.
touch "${runtimeDir}/perm-pending-$sid"

# Badge + notify in background
bq badge bell-exclamation --color '#ff6b35' --priority 25 --beep &
bq notify bertrand "Needs permission: $tool" &
wait
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
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
${EXTRACT_TOOL}

# Don't double-log: AskUserQuestion has its own waiting/answered events, and
# EnterWorktree/ExitWorktree have their own worktree.entered/exited hooks.
case "$tool" in AskUserQuestion|EnterWorktree|ExitWorktree) exit 0 ;; esac

marker="${runtimeDir}/perm-pending-$sid"
had_marker=0
if [ -f "$marker" ]; then
  had_marker=1
  rm -f "$marker"
  bq badge --clear &
fi

cid="\${BERTRAND_CLAUDE_ID:-}"

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
    bq update --session-id "$sid" --event tool.applied --summary "$summary" --meta "$meta"
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
bq update --session-id "$sid" --event tool.used --meta "$(jq -n --arg t "$tool" --arg d "$detail" --arg o "$outcome" --arg cid "$cid" '{tool:$t, detail:$d, outcome:$o, claude_id:$cid}')"
wait
`;
}

/**
 * UserPromptSubmit → record user free-text prompt as user.prompt event.
 * Fires once per user turn (not hot-path), so jq for safe multi-line/escape
 * handling is fine — grep would mangle prompts containing quotes or newlines.
 */
export function userPromptScript(bin: string, runtimeDir: string): string {
  return `#!/usr/bin/env bash
# Hook: UserPromptSubmit → record user prompt + re-inject the session contract.
#
# The contract normally arrives via --append-system-prompt on bertrand's own
# claude spawn, which reaches only that one process. Sessions that inherit the
# BERTRAND_* env vars without going through launchClaude (background jobs,
# nested \`claude\`, the Warp plugin's own launcher) never receive it. Re-
# injecting here — through the durable env/hook channel — closes that gap.
# Full contract on the first prompt of each conversation, a one-line reminder
# thereafter, to keep the per-turn token cost low.
${quietHelper(bin)}
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
cid="\${BERTRAND_CLAUDE_ID:-}"

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
 * reach (background jobs, nested claude, the Warp launcher).
 */
export function doneScript(bin: string, runtimeDir: string): string {
  return `#!/usr/bin/env bash
# Hook: Stop → enforce AUQ loop, else flip session status to paused.
${quietHelper(bin)}
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
cid="\${BERTRAND_CLAUDE_ID:-}"

done_marker="${runtimeDir}/done-$sid"
nudge_marker="${runtimeDir}/auq-nudge-$sid"

# Capture the assistant turn either way. Stdout is muted so it can never corrupt
# a decision-JSON payload. Dedups against the most-recent AskUQ-time capture, so
# a Done-for-now exit lands zero new events; a dropped-AUQ Stop records the
# stray turn; intermediate Stops with fresh output land normally.
tpath="$(printf '%s' "$input" | grep -o '"transcript_path":"[^"]*"' | cut -d'"' -f4)"
if [ -n "$tpath" ]; then
  bq assistant-message --session-id "$sid" --transcript-path "$tpath" --conversation-id "$cid" >/dev/null &
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

# Terminal path: legitimate Done-for-now exit, or nudge cap exhausted.
rm -f "$done_marker" "$nudge_marker"
bq update --session-id "$sid" --event session.paused
bq badge check --color '#58c142' --priority 10
wait
`;
}

/**
 * PostToolUse EnterWorktree → record the worktree path + branch on the session.
 *
 * The PostToolUse payload's `cwd` is the freshly-entered worktree directory (the
 * tool switches the session's cwd before this hook fires), so we read it and
 * resolve the branch from git rather than parsing the human-readable result
 * text. A `worktree-$sid` marker mirrors the path so on-exit-worktree.sh can
 * name what was left, and so siblings have offline awareness of it. Worktree
 * tools fire rarely, so jq parsing is fine — no grep hot-path needed.
 */
export function enterWorktreeScript(bin: string, runtimeDir: string): string {
  return `#!/usr/bin/env bash
# Hook: PostToolUse EnterWorktree → record worktree path + branch on the session.
${quietHelper(bin)}
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
cid="\${BERTRAND_CLAUDE_ID:-}"

path="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
[ -z "$path" ] && exit 0
branch="$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null)"

printf '%s' "$path" > "${runtimeDir}/worktree-$sid"

bq update --session-id "$sid" --event worktree.entered --meta "$(jq -n --arg p "$path" --arg b "$branch" --arg cid "$cid" '{path:$p, branch:$b, claude_id:$cid}')"
`;
}

/**
 * PostToolUse ExitWorktree → clear the session's worktree state. The worktree
 * may have been removed (action:remove), so we recover the path from the marker
 * written on entry rather than touching the (possibly gone) directory.
 */
export function exitWorktreeScript(bin: string, runtimeDir: string): string {
  return `#!/usr/bin/env bash
# Hook: PostToolUse ExitWorktree → clear the session's worktree state.
${quietHelper(bin)}
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

cid="\${BERTRAND_CLAUDE_ID:-}"
marker="${runtimeDir}/worktree-$sid"
path="$(cat "$marker" 2>/dev/null)"
rm -f "$marker"

bq update --session-id "$sid" --event worktree.exited --meta "$(jq -n --arg p "$path" --arg cid "$cid" '{path:$p, claude_id:$cid}')"
`;
}

export const HOOK_SCRIPTS = {
  "on-waiting.sh": waitingScript,
  "on-answered.sh": answeredScript,
  "on-permission-wait.sh": permissionWaitScript,
  "on-permission-done.sh": permissionDoneScript,
  "on-user-prompt.sh": userPromptScript,
  "on-done.sh": doneScript,
  "on-enter-worktree.sh": enterWorktreeScript,
  "on-exit-worktree.sh": exitWorktreeScript,
} as const;
