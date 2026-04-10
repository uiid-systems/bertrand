/**
 * Bash hook script templates.
 *
 * Architecture: Claude Code hooks → bash scripts → `bertrand update` → SQLite
 * Terminal integration via `bertrand badge` / `bertrand notify` (adapter-based).
 * The hooks read BERTRAND_SESSION (session ID) and BERTRAND_CLAUDE_ID from env.
 */

/** PreToolUse AskUserQuestion → mark session as blocked */
export function blockedScript(): string {
  return `#!/usr/bin/env bash
# Hook: PreToolUse AskUserQuestion → mark session as blocked
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
question="$(printf '%s' "$input" | jq -r '.tool_input.questions[0]?.question // empty' 2>/dev/null | cut -c1-120)"
[ -z "$question" ] && question="Waiting for input"

cid="\${BERTRAND_CLAUDE_ID:-}"
bertrand update --session-id "$sid" --event session.block --meta "$(jq -n --arg q "$question" --arg cid "$cid" '{question:$q, claude_id:$cid}')"

# Extract "Done for now" description as rolling session summary
done_desc="$(printf '%s' "$input" | jq -r '.tool_input.questions[]?.options[]? | select(.label == "Done for now") | .description // empty' 2>/dev/null | head -1 | cut -c1-120)"
if [ -n "$done_desc" ]; then
  bertrand update --session-id "$sid" --event context.snapshot --meta "$(jq -n --arg s "$done_desc" '{summary:$s}')"
fi

bertrand badge message-question --color '#e0b956' --priority 20 --beep
bertrand notify bertrand "$question"
`;
}

/** PostToolUse AskUserQuestion → mark session as prompting (user answered) */
export function resumedScript(): string {
  return `#!/usr/bin/env bash
# Hook: PostToolUse AskUserQuestion → mark session as prompting
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
cid="\${BERTRAND_CLAUDE_ID:-}"

# Extract user answer
answer="$(printf '%s' "$input" | jq -r '
  (.tool_input.answers // {} | to_entries | map(.value | tostring) | join(", ") | select(. != "")) //
  (.tool_response | objects | .answers // {} | to_entries | map(.value | tostring) | join(", ") | select(. != "")) //
  empty
' 2>/dev/null | head -1 | cut -c1-200)"

bertrand update --session-id "$sid" --event session.resume --meta "$(jq -n --arg a "$answer" --arg cid "$cid" '{answer:$a, claude_id:$cid}')"

bertrand badge --clear
`;
}

/** PreToolUse (catch-all) → flip prompting to working */
export function workingScript(): string {
  return `#!/usr/bin/env bash
# Hook: PreToolUse (catch-all) → flip prompting to working
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)"

# AskUserQuestion has its own PreToolUse hook
[ "$tool" = "AskUserQuestion" ] && exit 0

cid="\${BERTRAND_CLAUDE_ID:-}"
bertrand update --session-id "$sid" --event session.working --meta "$(jq -n --arg cid "$cid" '{claude_id:$cid}')"
`;
}

/** PermissionRequest → write pending marker for real permission prompts */
export function permissionWaitScript(): string {
  return `#!/usr/bin/env bash
# Hook: PermissionRequest → pending marker for permission prompts
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)"
[ "$tool" = "AskUserQuestion" ] && exit 0

# Extract detail from tool_input
detail=""
case "$tool" in
  Bash) detail="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null | cut -c1-80)" ;;
  Edit|Write|Read) detail="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null | cut -c1-80)" ;;
esac

cid="\${BERTRAND_CLAUDE_ID:-}"
bertrand update --session-id "$sid" --event permission.request --meta "$(jq -n --arg t "$tool" --arg d "$detail" --arg cid "$cid" '{tool:$t, detail:$d, claude_id:$cid}')"

bertrand badge bell-exclamation --color '#ff6b35' --priority 25 --beep
bertrand notify bertrand "Needs permission: $tool"
`;
}

/** PostToolUse (catch-all) → remove pending marker */
export function permissionDoneScript(): string {
  return `#!/usr/bin/env bash
# Hook: PostToolUse (catch-all) → clear pending marker
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)"

# Skip always-auto-approved tools
case "$tool" in
  AskUserQuestion|Read|Glob|Grep|ToolSearch) exit 0 ;;
esac

# Extract detail
detail=""
case "$tool" in
  Bash) detail="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null | cut -c1-80)" ;;
  Edit|Write|Read) detail="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null | cut -c1-80)" ;;
esac

cid="\${BERTRAND_CLAUDE_ID:-}"
bertrand update --session-id "$sid" --event permission.resolve --meta "$(jq -n --arg t "$tool" --arg d "$detail" --arg cid "$cid" '{tool:$t, detail:$d, claude_id:$cid}')"

bertrand badge --clear
`;
}

/** Stop hook → mark session as paused */
export function doneScript(): string {
  return `#!/usr/bin/env bash
# Hook: Stop → mark session as paused
sid="\${BERTRAND_SESSION:-}"
[ -z "$sid" ] && exit 0

cid="\${BERTRAND_CLAUDE_ID:-}"
bertrand update --session-id "$sid" --event session.paused --meta "$(jq -n --arg cid "$cid" '{claude_id:$cid}')"

bertrand badge check --color '#58c142' --priority 10
`;
}

export const HOOK_SCRIPTS = {
  "on-blocked.sh": blockedScript,
  "on-resumed.sh": resumedScript,
  "on-working.sh": workingScript,
  "on-permission-wait.sh": permissionWaitScript,
  "on-permission-done.sh": permissionDoneScript,
  "on-done.sh": doneScript,
} as const;
