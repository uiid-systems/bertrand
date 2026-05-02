/**
 * Bash hook script templates.
 *
 * Architecture: Claude Code hooks → bash scripts → `${BIN} update` → SQLite
 * Terminal integration via `${BIN} badge` / `${BIN} notify` (adapter-based).
 * The hooks read BERTRAND_SESSION (session ID) and BERTRAND_CLAUDE_ID from env.
 *
 * Performance notes:
 *   - grep/sed used instead of jq for simple field extraction (~1ms vs ~15ms)
 *   - jq -n kept for building meta JSON (safe escaping, acceptable cost)
 *   - permissionDoneScript folds diff extraction into the existing jq invocation
 *     so adding old_str/new_str capture costs nothing extra
 *   - badge/notify backgrounded where possible (terminal UI doesn't need to block Claude)
 *   - activeScript has a debounce guard to skip redundant updates
 */

import { paths } from "@/lib/paths";

/** Absolute path to the TS bertrand binary — avoids resolving the Go binary from PATH */
const BIN = paths.bin;

/** Extract a JSON string field via grep — ~1ms vs jq's ~15ms */
const EXTRACT_TOOL = `tool="$(printf '%s' "$input" | grep -o '"tool_name":"[^"]*"' | cut -d'"' -f4)"`;

/** PreToolUse AskUserQuestion → mark session as waiting */
export function waitingScript(): string {
  return `#!/usr/bin/env bash
# Hook: PreToolUse AskUserQuestion → mark session as waiting
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
cid="\${BERTRAND_CLAUDE_ID:-}"

# Extract question — grep for simple field extraction (~1ms vs jq ~15ms)
question="$(printf '%s' "$input" | grep -o '"question":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-2000)"
[ -z "$question" ] && question="Waiting for input"

# Clear working debounce marker so next resume→working transition fires
rm -f "/tmp/bertrand-working-$sid"

${BIN} update --session-id "$sid" --event session.waiting --meta "$(jq -n --arg q "$question" --arg cid "$cid" '{question:$q, claude_id:$cid}')"

# Context snapshot — extract transcript path and capture token usage
tpath="$(printf '%s' "$input" | grep -o '"transcript_path":"[^"]*"' | cut -d'"' -f4)"
if [ -n "$tpath" ]; then
  ${BIN} snapshot --session-id "$sid" --transcript-path "$tpath" --conversation-id "$cid" &
fi

# Badge + notify in background — terminal UI doesn't need to block Claude
${BIN} badge message-question --color '#e0b956' --priority 20 --beep &
${BIN} notify bertrand "$question" &
wait
`;
}

/** PostToolUse AskUserQuestion → mark session as active (user answered) */
export function answeredScript(): string {
  return `#!/usr/bin/env bash
# Hook: PostToolUse AskUserQuestion → mark session as active
#
# If the user's answer contains "Done for now", emit {"continue": false} to
# Claude Code so the agent halts immediately instead of taking another turn.
# This is the mechanical enforcement of the contract's loop-exit rule — the
# contract prose is a soft hint, this JSON is the guarantee.
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
cid="\${BERTRAND_CLAUDE_ID:-}"

# Capture the structured answers object (and any annotations) so the UI can
# render each Q→A pair distinctly. We do not store a joined string — the
# Done-for-now check derives from the raw values inline.
meta="$(printf '%s' "$input" | jq --arg cid "$cid" '
  {
    answers: ((.tool_input.answers // .tool_response.answers) // {}),
    annotations: ((.tool_input.annotations // .tool_response.annotations) // {}),
    claude_id: $cid
  }
' 2>/dev/null)"

# Concatenate all answer values into a single string for the Done-for-now check.
done_check="$(printf '%s' "$meta" | jq -r '.answers | to_entries | map(.value | tostring) | join(" ")' 2>/dev/null)"

${BIN} update --session-id "$sid" --event session.answered --meta "$meta"

${BIN} badge --clear &

# Halt the agent loop if the user signaled Done for now. The Stop hook
# (on-done.sh) will fire afterwards and mark the session as paused.
if printf '%s' "$done_check" | grep -q "Done for now"; then
  printf '{"continue": false, "stopReason": "User selected Done for now"}\\n'
fi

wait
`;
}

/** PreToolUse (catch-all) → flip waiting to active */
export function activeScript(): string {
  return `#!/usr/bin/env bash
# Hook: PreToolUse (catch-all) → flip waiting to active
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
${BIN} update --session-id "$sid" --event session.active --meta "$(jq -n --arg cid "$cid" '{claude_id:$cid}')"
`;
}

/** PermissionRequest → write pending marker + emit permission.request */
export function permissionWaitScript(): string {
  return `#!/usr/bin/env bash
# Hook: PermissionRequest → mark pending, emit permission.request
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
${BIN} update --session-id "$sid" --event permission.request --meta "$(jq -n --arg t "$tool" --arg d "$detail" --arg cid "$cid" '{tool:$t, detail:$d, claude_id:$cid}')"

# Badge + notify in background
${BIN} badge bell-exclamation --color '#ff6b35' --priority 25 --beep &
${BIN} notify bertrand "Needs permission: $tool" &
wait
`;
}

/** PostToolUse (catch-all) → emit tool.applied for edits, permission.resolve for prompted tools */
export function permissionDoneScript(): string {
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
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
${EXTRACT_TOOL}

marker="/tmp/bertrand-perm-pending-$sid"
had_marker=0
if [ -f "$marker" ]; then
  had_marker=1
  rm -f "$marker"
  ${BIN} badge --clear &
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
    ${BIN} update --session-id "$sid" --event tool.applied --summary "$summary" --meta "$meta"
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

${BIN} update --session-id "$sid" --event permission.resolve --meta "$(jq -n --arg t "$tool" --arg d "$detail" --arg cid "$cid" '{tool:$t, detail:$d, outcome:"approved", claude_id:$cid}')"
wait
`;
}

/** Stop hook → mark session as paused + final context snapshot */
export function doneScript(): string {
  return `#!/usr/bin/env bash
# Hook: Stop → mark session as paused
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
cid="\${BERTRAND_CLAUDE_ID:-}"
${BIN} update --session-id "$sid" --event session.paused --meta "$(jq -n --arg cid "$cid" '{claude_id:$cid}')"

# Final context snapshot — capture token usage at session end
tpath="$(printf '%s' "$input" | grep -o '"transcript_path":"[^"]*"' | cut -d'"' -f4)"
if [ -n "$tpath" ]; then
  ${BIN} snapshot --session-id "$sid" --transcript-path "$tpath" --conversation-id "$cid" &
fi

${BIN} badge check --color '#58c142' --priority 10
`;
}

export const HOOK_SCRIPTS = {
  "on-waiting.sh": waitingScript,
  "on-answered.sh": answeredScript,
  "on-active.sh": activeScript,
  "on-permission-wait.sh": permissionWaitScript,
  "on-permission-done.sh": permissionDoneScript,
  "on-done.sh": doneScript,
} as const;
