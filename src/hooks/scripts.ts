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
export function waitingScript(bin: string): string {
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
rm -f "/tmp/bertrand-working-$sid"

bq update --session-id "$sid" --event session.waiting --meta "$(jq -n --arg q "$question" --arg cid "$cid" '{question:$q, claude_id:$cid}')"

# Context snapshot — extract transcript path and capture token usage
tpath="$(printf '%s' "$input" | grep -o '"transcript_path":"[^"]*"' | cut -d'"' -f4)"
if [ -n "$tpath" ]; then
  bq snapshot --session-id "$sid" --transcript-path "$tpath" --conversation-id "$cid" &
  bq recap-thinking --session-id "$sid" --transcript-path "$tpath" --conversation-id "$cid" &
fi

# Badge + notify in background — terminal UI doesn't need to block Claude
bq badge message-question --color '#e0b956' --priority 20 --beep &
bq notify bertrand "$question" &
wait
`;
}

/** PostToolUse AskUserQuestion → mark session as active (user answered) */
export function answeredScript(bin: string): string {
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

# Halt the agent loop if the user signaled Done for now. The Stop hook
# (on-done.sh) will fire afterwards and mark the session as paused.
if printf '%s' "$done_check" | grep -q "Done for now"; then
  # Promote the picked Done-for-now option's description into a session.recap
  # event so the timeline has a dedicated end-of-session summary row. Bertrand
  # forces session exit before Claude can write a closing message, so this
  # reuses the agent-authored recap that already lives on the option.
  recap="$(printf '%s' "$meta" | jq -r '
    [.questions[]?.options[]? | select(.label == "Done for now") | .description] | first // empty
  ' 2>/dev/null)"
  if [ -n "$recap" ]; then
    bq update --session-id "$sid" --event session.recap \
      --meta "$(jq -n --arg recap "$recap" --arg cid "$cid" '{recap:$recap, claude_id:$cid}')"
  fi

  printf '{"continue": false, "stopReason": "User selected Done for now"}\\n'
fi

wait
`;
}

/** PreToolUse (catch-all) → flip waiting to active */
export function activeScript(bin: string): string {
  return `#!/usr/bin/env bash
# Hook: PreToolUse (catch-all) → flip waiting to active
${quietHelper(bin)}
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

# Debounce: skip if we already sent session.active within the last 5 seconds.
# This avoids spawning bertrand (~31ms) on every tool call during rapid sequences.
marker="/tmp/bertrand-working-$sid"
if [ -f "$marker" ]; then
  age=$(( $(date +%s) - $(stat -f%m "$marker" 2>/dev/null || echo 0) ))
  [ "$age" -lt 5 ] && exit 0
fi

input="$(cat)"
${EXTRACT_TOOL}

# AskUserQuestion has its own PreToolUse hook
[ "$tool" = "AskUserQuestion" ] && exit 0

touch "$marker"
cid="\${BERTRAND_CLAUDE_ID:-}"
bq update --session-id "$sid" --event session.active --meta "$(jq -n --arg cid "$cid" '{claude_id:$cid}')"
`;
}

/** PermissionRequest → write pending marker + emit permission.request */
export function permissionWaitScript(bin: string): string {
  return `#!/usr/bin/env bash
# Hook: PermissionRequest → mark pending, emit permission.request
${quietHelper(bin)}
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
${EXTRACT_TOOL}
[ "$tool" = "AskUserQuestion" ] && exit 0

# Write marker so PostToolUse knows this was a real permission prompt (not auto-approved)
touch "/tmp/bertrand-perm-pending-$sid"

# Extract detail from tool_input via grep (avoid jq for simple fields)
detail=""
case "$tool" in
  Bash) detail="$(printf '%s' "$input" | grep -o '"command":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-1000)" ;;
  Edit|Write|Read) detail="$(printf '%s' "$input" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-1000)" ;;
esac

cid="\${BERTRAND_CLAUDE_ID:-}"
bq update --session-id "$sid" --event permission.request --meta "$(jq -n --arg t "$tool" --arg d "$detail" --arg cid "$cid" '{tool:$t, detail:$d, claude_id:$cid}')"

# Badge + notify in background
bq badge bell-exclamation --color '#ff6b35' --priority 25 --beep &
bq notify bertrand "Needs permission: $tool" &
wait
`;
}

/** PostToolUse (catch-all) → emit tool.applied for edits, permission.resolve for prompted tools */
export function permissionDoneScript(bin: string): string {
  return `#!/usr/bin/env bash
# Hook: PostToolUse (catch-all)
#
# Two flows:
#   1. Edit/Write/MultiEdit: ALWAYS emit tool.applied with diff, regardless of permission
#      flow. This is the only way to capture diffs for auto-approved edits — bertrand
#      must never require disabling auto-approve to gather data.
#   2. Other tools: emit permission.resolve only if a PermissionRequest preceded this
#      (marker exists). Rejected tools never reach PostToolUse, so a request without a
#      resolve = rejected.
${quietHelper(bin)}
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
${EXTRACT_TOOL}

marker="/tmp/bertrand-perm-pending-$sid"
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
    # Single jq pass: build meta.permissions[] with diff data so the dashboard renders
    # via the existing WorkContent path (same shape as collapsed permission events).
    # Emit camelCase keys (oldStr/newStr/edits) directly so WorkContent reads
    # meta.permissions[] without going through transforms.ts's snake→camel adapter.
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

# Other tools: only emit permission.resolve if there was a real prompt
[ "$had_marker" = "0" ] && exit 0

detail=""
case "$tool" in
  Bash) detail="$(printf '%s' "$input" | grep -o '"command":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-1000)" ;;
esac

bq update --session-id "$sid" --event permission.resolve --meta "$(jq -n --arg t "$tool" --arg d "$detail" --arg cid "$cid" '{tool:$t, detail:$d, outcome:"approved", claude_id:$cid}')"
wait
`;
}

/**
 * UserPromptSubmit → record user free-text prompt as user.prompt event.
 * Fires once per user turn (not hot-path), so jq for safe multi-line/escape
 * handling is fine — grep would mangle prompts containing quotes or newlines.
 */
export function userPromptScript(bin: string): string {
  return `#!/usr/bin/env bash
# Hook: UserPromptSubmit → record user free-text prompt
${quietHelper(bin)}
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
cid="\${BERTRAND_CLAUDE_ID:-}"

meta="$(printf '%s' "$input" | jq --arg cid "$cid" '{prompt: (.prompt // ""), claude_id: $cid}')"
[ -z "$meta" ] && exit 0

bq update --session-id "$sid" --event user.prompt --meta "$meta"
`;
}

/** Stop hook → mark session as paused + final context snapshot */
export function doneScript(bin: string): string {
  return `#!/usr/bin/env bash
# Hook: Stop → mark session as paused
${quietHelper(bin)}
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
cid="\${BERTRAND_CLAUDE_ID:-}"
bq update --session-id "$sid" --event session.paused --meta "$(jq -n --arg cid "$cid" '{claude_id:$cid}')"

# Final context snapshot — capture token usage at session end
tpath="$(printf '%s' "$input" | grep -o '"transcript_path":"[^"]*"' | cut -d'"' -f4)"
if [ -n "$tpath" ]; then
  bq snapshot --session-id "$sid" --transcript-path "$tpath" --conversation-id "$cid" &
  bq assistant-message --session-id "$sid" --transcript-path "$tpath" --conversation-id "$cid" &
fi

bq badge check --color '#58c142' --priority 10
`;
}

export const HOOK_SCRIPTS = {
  "on-waiting.sh": waitingScript,
  "on-answered.sh": answeredScript,
  "on-active.sh": activeScript,
  "on-permission-wait.sh": permissionWaitScript,
  "on-permission-done.sh": permissionDoneScript,
  "on-user-prompt.sh": userPromptScript,
  "on-done.sh": doneScript,
} as const;
