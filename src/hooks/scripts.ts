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
question="$(printf '%s' "$input" | grep -o '"question":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-120)"
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
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
cid="\${BERTRAND_CLAUDE_ID:-}"

# Extract user answer — jq needed here for complex nested extraction
answer="$(printf '%s' "$input" | jq -r '
  (.tool_input.answers // {} | to_entries | map(.value | tostring) | join(", ") | select(. != "")) //
  (.tool_response | objects | .answers // {} | to_entries | map(.value | tostring) | join(", ") | select(. != "")) //
  empty
' 2>/dev/null | head -1 | cut -c1-200)"

${BIN} update --session-id "$sid" --event session.answered --meta "$(jq -n --arg a "$answer" --arg cid "$cid" '{answer:$a, claude_id:$cid}')"

${BIN} badge --clear &
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
  Bash) detail="$(printf '%s' "$input" | grep -o '"command":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-80)" ;;
  Edit|Write|Read) detail="$(printf '%s' "$input" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-80)" ;;
esac

cid="\${BERTRAND_CLAUDE_ID:-}"
${BIN} update --session-id "$sid" --event permission.request --meta "$(jq -n --arg t "$tool" --arg d "$detail" --arg cid "$cid" '{tool:$t, detail:$d, claude_id:$cid}')"

# Badge + notify in background
${BIN} badge bell-exclamation --color '#ff6b35' --priority 25 --beep &
${BIN} notify bertrand "Needs permission: $tool" &
wait
`;
}

/** PostToolUse (catch-all) → resolve permission if manually prompted */
export function permissionDoneScript(): string {
  return `#!/usr/bin/env bash
# Hook: PostToolUse (catch-all) → emit permission.resolve only for manually-prompted tools
# Auto-approved tools have no pending marker, so they're skipped entirely.
# Rejected tools never reach PostToolUse, so rejection = request with no resolve.
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

# Only fire if a PermissionRequest preceded this (marker exists)
marker="/tmp/bertrand-perm-pending-$sid"
[ ! -f "$marker" ] && exit 0
rm -f "$marker"

input="$(cat)"
${EXTRACT_TOOL}

# Extract detail via grep
detail=""
case "$tool" in
  Bash) detail="$(printf '%s' "$input" | grep -o '"command":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-80)" ;;
  Edit|Write) detail="$(printf '%s' "$input" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4 | cut -c1-80)" ;;
esac

cid="\${BERTRAND_CLAUDE_ID:-}"
${BIN} update --session-id "$sid" --event permission.resolve --meta "$(jq -n --arg t "$tool" --arg d "$detail" --arg cid "$cid" '{tool:$t, detail:$d, outcome:"approved", claude_id:$cid}')"

${BIN} badge --clear &
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
