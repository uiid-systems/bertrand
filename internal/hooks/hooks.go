package hooks

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/uiid-systems/bertrand/internal/session"
)

// HookScript returns the shell script content for a hook.
func BlockedScript() string {
	return `#!/usr/bin/env bash
# Hook: PreToolUse AskUserQuestion → mark session as blocked
BERTRAND_PID="${BERTRAND_PID:-}"
[ -z "$BERTRAND_PID" ] && exit 0

name="$(cat "$HOME/.bertrand/tmp/$BERTRAND_PID" 2>/dev/null)" || exit 0
[ -z "$name" ] && exit 0

input="$(cat)"
raw="$(printf '%s' "$input" | grep -o '"question"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"question"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"
# Strip "sessionName » " or "bertrand:sessionName > " prefix
# Use | delimiter — session names contain / which breaks s///
summary="$(printf '%s' "$raw" | sed "s|^${name} [^a-zA-Z]* ||" | sed "s|^bertrand:${name} > ||" | cut -c1-80)"
[ -z "$summary" ] && summary="Waiting for input"

bertrand update --name "$name" --status blocked --summary "$summary"

# Log event
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
esc_summary="$(printf '%s' "$summary" | sed 's/\\/\\\\/g; s/"/\\"/g')"
printf '{"v":1,"event":"session.block","session":"%s","ts":"%s","meta":{"question":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$esc_summary" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"session.block","session":"%s","ts":"%s","meta":{"question":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$esc_summary" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

func ResumedScript() string {
	return `#!/usr/bin/env bash
# Hook: PostToolUse AskUserQuestion → mark session as working
BERTRAND_PID="${BERTRAND_PID:-}"
[ -z "$BERTRAND_PID" ] && exit 0

name="$(cat "$HOME/.bertrand/tmp/$BERTRAND_PID" 2>/dev/null)" || exit 0
[ -z "$name" ] && exit 0

bertrand update --name "$name" --status working --summary "Resumed after input"

# Log event
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
printf '{"v":1,"event":"session.resume","session":"%s","ts":"%s","meta":{"claude_id":"%s"}}\n' "$name" "$ts" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"session.resume","session":"%s","ts":"%s","meta":{"claude_id":"%s"}}\n' "$name" "$ts" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// PermissionWaitScript returns the hook script that writes a pending marker
// when a real permission dialog is shown (PermissionRequest event). This only
// fires when the user is actually prompted — auto-approved tools never trigger it.
func PermissionWaitScript() string {
	return `#!/usr/bin/env bash
# Hook: PermissionRequest (all tools) → write pending marker for real permission prompts
BERTRAND_PID="${BERTRAND_PID:-}"
[ -z "$BERTRAND_PID" ] && exit 0

name="$(cat "$HOME/.bertrand/tmp/$BERTRAND_PID" 2>/dev/null)" || exit 0
[ -z "$name" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"

# Write pending marker — this hook only fires for real permission prompts
mkdir -p "$HOME/.bertrand/sessions/$name" 2>/dev/null
printf '%s' "$tool" > "$HOME/.bertrand/sessions/$name/pending"

# Log event
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
printf '{"v":1,"event":"permission.request","session":"%s","ts":"%s","meta":{"tool":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$tool" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"permission.request","session":"%s","ts":"%s","meta":{"tool":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$tool" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// PermissionDoneScript returns the hook script that removes the pending marker
// when any tool (except AskUserQuestion) completes via PostToolUse.
func PermissionDoneScript() string {
	return `#!/usr/bin/env bash
# Hook: PostToolUse (all tools) → remove pending marker
BERTRAND_PID="${BERTRAND_PID:-}"
[ -z "$BERTRAND_PID" ] && exit 0

name="$(cat "$HOME/.bertrand/tmp/$BERTRAND_PID" 2>/dev/null)" || exit 0
[ -z "$name" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"

# Skip tools that are always auto-approved (no permission prompt)
case "$tool" in
  AskUserQuestion|Read|Glob|Grep|ToolSearch) exit 0 ;;
esac

rm -f "$HOME/.bertrand/sessions/$name/pending"

# Log event
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
printf '{"v":1,"event":"permission.resolve","session":"%s","ts":"%s","meta":{"tool":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$tool" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"permission.resolve","session":"%s","ts":"%s","meta":{"tool":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$tool" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// WorktreeEnteredScript returns the hook script that writes a worktree marker
// when a session enters a git worktree via EnterWorktree.
func WorktreeEnteredScript() string {
	return `#!/usr/bin/env bash
# Hook: PostToolUse EnterWorktree → write worktree marker
BERTRAND_PID="${BERTRAND_PID:-}"
[ -z "$BERTRAND_PID" ] && exit 0

name="$(cat "$HOME/.bertrand/tmp/$BERTRAND_PID" 2>/dev/null)" || exit 0
[ -z "$name" ] && exit 0

input="$(cat)"
# Extract branch name from tool output — best effort
branch="$(printf '%s' "$input" | grep -o 'branch [^ ]*' | head -1 | sed 's/branch //')"
[ -z "$branch" ] && branch="unknown"
esc_branch="$(printf '%s' "$branch" | sed 's/\\/\\\\/g; s/"/\\"/g')"

# Write worktree marker file
mkdir -p "$HOME/.bertrand/sessions/$name" 2>/dev/null
printf '%s' "$branch" > "$HOME/.bertrand/sessions/$name/worktree"

# Log event
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
printf '{"v":1,"event":"worktree.entered","session":"%s","ts":"%s","meta":{"branch":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$esc_branch" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"worktree.entered","session":"%s","ts":"%s","meta":{"branch":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$esc_branch" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// WorktreeExitedScript returns the hook script that removes the worktree marker
// when a session exits a git worktree via ExitWorktree.
func WorktreeExitedScript() string {
	return `#!/usr/bin/env bash
# Hook: PostToolUse ExitWorktree → remove worktree marker
BERTRAND_PID="${BERTRAND_PID:-}"
[ -z "$BERTRAND_PID" ] && exit 0

name="$(cat "$HOME/.bertrand/tmp/$BERTRAND_PID" 2>/dev/null)" || exit 0
[ -z "$name" ] && exit 0

# Remove worktree marker
rm -f "$HOME/.bertrand/sessions/$name/worktree"

# Log event
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
printf '{"v":1,"event":"worktree.exited","session":"%s","ts":"%s","meta":{"claude_id":"%s"}}\n' "$name" "$ts" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"worktree.exited","session":"%s","ts":"%s","meta":{"claude_id":"%s"}}\n' "$name" "$ts" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// GhCommandScript returns the hook script that detects gh CLI commands
// (pr create, pr merge) from PostToolUse Bash events and logs them.
func GhCommandScript() string {
	return `#!/usr/bin/env bash
# Hook: PostToolUse Bash → detect gh CLI commands
BERTRAND_PID="${BERTRAND_PID:-}"
[ -z "$BERTRAND_PID" ] && exit 0

name="$(cat "$HOME/.bertrand/tmp/$BERTRAND_PID" 2>/dev/null)" || exit 0
[ -z "$name" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"

# Only process Bash tool calls
[ "$tool" != "Bash" ] && exit 0

# Extract the command from tool_input
cmd="$(printf '%s' "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"

case "$cmd" in
  gh\ pr\ create*|gh\ pr\ create)
    # Try to extract PR URL from the tool response
    pr_url="$(printf '%s' "$input" | grep -oE 'https://github\.com/[^/]+/[^/]+/pull/[0-9]+' | head -1)"
    pr_number="$(printf '%s' "$pr_url" | grep -oE '[0-9]+$')"
    branch="$(printf '%s' "$input" | grep -o '"branch"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"branch"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"
    [ -z "$pr_number" ] && pr_number=""
    [ -z "$pr_url" ] && pr_url=""
    [ -z "$branch" ] && branch=""
    printf '{"v":1,"event":"gh.pr.created","session":"%s","ts":"%s","meta":{"pr_number":"%s","pr_url":"%s","branch":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$pr_number" "$pr_url" "$branch" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
    printf '{"v":1,"event":"gh.pr.created","session":"%s","ts":"%s","meta":{"pr_number":"%s","pr_url":"%s","branch":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$pr_number" "$pr_url" "$branch" "$cid" >> "$HOME/.bertrand/log.jsonl"
    ;;
  gh\ pr\ merge*)
    pr_number="$(printf '%s' "$cmd" | grep -oE '[0-9]+' | head -1)"
    branch=""
    [ -z "$pr_number" ] && pr_number=""
    printf '{"v":1,"event":"gh.pr.merged","session":"%s","ts":"%s","meta":{"pr_number":"%s","branch":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$pr_number" "$branch" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
    printf '{"v":1,"event":"gh.pr.merged","session":"%s","ts":"%s","meta":{"pr_number":"%s","branch":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$pr_number" "$branch" "$cid" >> "$HOME/.bertrand/log.jsonl"
    ;;
esac
`
}

// LinearReadScript returns the hook script that logs Linear MCP tool usage.
func LinearReadScript() string {
	return `#!/usr/bin/env bash
# Hook: PostToolUse mcp__claude_ai_Linear__* → log Linear issue reads
BERTRAND_PID="${BERTRAND_PID:-}"
[ -z "$BERTRAND_PID" ] && exit 0

name="$(cat "$HOME/.bertrand/tmp/$BERTRAND_PID" 2>/dev/null)" || exit 0
[ -z "$name" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"

# Extract issue ID and title from the response (best effort)
issue_id="$(printf '%s' "$input" | grep -o '"id":"[A-Z]*-[0-9]*"' | head -1 | sed 's/"id":"//;s/"$//')"
issue_title="$(printf '%s' "$input" | grep -o '"title":"[^"]*"' | head -1 | sed 's/"title":"//;s/"$//')"
[ -z "$issue_id" ] && issue_id=""
esc_title="$(printf '%s' "$issue_title" | sed 's/\\/\\\\/g; s/"/\\"/g' | cut -c1-80)"

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
printf '{"v":1,"event":"linear.issue.read","session":"%s","ts":"%s","meta":{"issue_id":"%s","issue_title":"%s","tool_name":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$issue_id" "$esc_title" "$tool" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"linear.issue.read","session":"%s","ts":"%s","meta":{"issue_id":"%s","issue_title":"%s","tool_name":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$issue_id" "$esc_title" "$tool" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// StatuslineScript returns the statusline wrapper script.
// When BERTRAND_SESSION is set, it renders a session header line before
// delegating to the user's original statusline command (e.g. ccstatusline).
// When not in a bertrand session, it passes through to the fallback directly.
func StatuslineScript() string {
	return `#!/usr/bin/env bash
# Bertrand session statusline
# Invoked via --settings flag, so this only runs in bertrand sessions.
# Reads Claude's JSON context on stdin, renders session info.
input="$(cat)"
name="${BERTRAND_SESSION:-}"
[ -z "$name" ] && exit 0

HAS_JQ=0
command -v jq >/dev/null 2>&1 && HAS_JQ=1

# Colors (256-color ANSI — matches bertrand palette)
c_name=$'\033[1;38;5;120m'   # bright green, bold — session name
c_status=$'\033[38;5;78m'    # green — working
c_blocked=$'\033[38;5;214m'  # orange — blocked
c_dim=$'\033[38;5;241m'      # gray — labels/separators
c_val=$'\033[38;5;252m'      # light gray — values
c_ctx=$'\033[38;5;158m'      # mint — context ok
c_ctx_warn=$'\033[38;5;215m' # peach — context warning
c_ctx_crit=$'\033[38;5;203m' # red — context critical
c_rst=$'\033[0m'

# Session state
state_file="$HOME/.bertrand/sessions/$name/state.json"
status=""
if [ -f "$state_file" ]; then
  if [ "$HAS_JQ" -eq 1 ]; then
    status="$(jq -r '.status // ""' "$state_file" 2>/dev/null)"
  else
    status="$(grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' "$state_file" | head -1 | sed 's/.*"status"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"
  fi
fi

case "$status" in
  working) dot="${c_status}● working${c_rst}" ;;
  blocked) dot="${c_blocked}● blocked${c_rst}" ;;
  *)       dot="" ;;
esac

# Sibling count — scan state files for other active sessions
siblings=0
if [ -d "$HOME/.bertrand/sessions" ]; then
  for d in "$HOME/.bertrand/sessions"/*/state.json; do
    [ -f "$d" ] || continue
    sess_dir="$(dirname "$d")"
    sess_name="${sess_dir##*/}"
    [ "$sess_name" = "$name" ] && continue
    if [ "$HAS_JQ" -eq 1 ]; then
      spid="$(jq -r '.pid // 0' "$d" 2>/dev/null)"
      s="$(jq -r '.status // ""' "$d" 2>/dev/null)"
    else
      spid="$(grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9]*' "$d" | head -1 | sed 's/.*:[[:space:]]*//')"
      s="$(grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' "$d" | head -1 | sed 's/.*"status"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"
    fi
    [ "$s" = "done" ] && continue
    [ -n "$spid" ] && [ "$spid" != "0" ] && kill -0 "$spid" 2>/dev/null && siblings=$((siblings + 1))
  done
fi

# Session stats (precomputed by bertrand)
stats_file="$HOME/.bertrand/sessions/$name/stats.json"
duration=""
convs=""
if [ -f "$stats_file" ]; then
  if [ "$HAS_JQ" -eq 1 ]; then
    started_at="$(jq -r '.started_at // ""' "$stats_file" 2>/dev/null)"
    convs="$(jq -r '.conversations // 0' "$stats_file" 2>/dev/null)"
  else
    started_at=""
    convs=""
  fi
  if [ -n "$started_at" ] && [ "$started_at" != "null" ]; then
    # Compute duration from started_at to now
    clean_ts="${started_at%%.*}"  # strip fractional seconds
    clean_ts="${clean_ts%Z}"       # strip trailing Z
    start_epoch="$(date -u -jf '%Y-%m-%dT%H:%M:%S' "$clean_ts" +%s 2>/dev/null)"
    if [ -n "$start_epoch" ]; then
      now_epoch="$(date +%s)"
      elapsed=$((now_epoch - start_epoch))
      [ "$elapsed" -lt 0 ] && elapsed=0
      if [ "$elapsed" -ge 3600 ]; then
        hours=$((elapsed / 3600))
        mins=$(( (elapsed % 3600) / 60 ))
        duration="${hours}h ${mins}m"
      elif [ "$elapsed" -ge 60 ]; then
        mins=$((elapsed / 60))
        duration="${mins}m"
      else
        duration="${elapsed}s"
      fi
    fi
  fi
fi

# Claude JSON data
if [ "$HAS_JQ" -eq 1 ]; then
  model="$(echo "$input" | jq -r '.model.display_name // "Claude"' 2>/dev/null)"
  ctx_size="$(echo "$input" | jq -r '.context_window.context_window_size // 200000' 2>/dev/null)"
  usage="$(echo "$input" | jq '.context_window.current_usage' 2>/dev/null)"
  if [ "$usage" != "null" ] && [ -n "$usage" ]; then
    tokens="$(echo "$usage" | jq '(.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)' 2>/dev/null)"
  fi
else
  model="$(echo "$input" | grep -o '"display_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"display_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"
  [ -z "$model" ] && model="Claude"
  tokens=""
fi

# Context remaining
ctx_pct=""
if [ -n "$tokens" ] && [ "$tokens" -gt 0 ] 2>/dev/null; then
  used_pct=$((tokens * 100 / ctx_size))
  remaining=$((100 - used_pct))
  [ "$remaining" -lt 0 ] && remaining=0
  [ "$remaining" -gt 100 ] && remaining=100
  ctx_pct="$remaining"
  if [ "$remaining" -le 20 ]; then
    ctx_color="$c_ctx_crit"
  elif [ "$remaining" -le 40 ]; then
    ctx_color="$c_ctx_warn"
  else
    ctx_color="$c_ctx"
  fi
fi

# ── Context snapshot (throttled) ──
if [ -n "$tokens" ] && [ "$tokens" -gt 0 ] 2>/dev/null; then
  snap_marker="$HOME/.bertrand/sessions/$name/.last-ctx-snap"
  should_log=1
  if [ -f "$snap_marker" ]; then
    last_epoch="$(cat "$snap_marker" 2>/dev/null)"
    now_epoch="$(date +%s)"
    if [ -n "$last_epoch" ] && [ $((now_epoch - last_epoch)) -lt 60 ]; then
      should_log=0
    fi
  fi
  if [ "$should_log" -eq 1 ]; then
    date +%s > "$snap_marker"
    snap_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    cid="${BERTRAND_CLAUDE_ID:-}"
    # Extract individual token counts for the snapshot
    if [ "$HAS_JQ" -eq 1 ]; then
      snap_input="$(echo "$usage" | jq '(.input_tokens // 0)' 2>/dev/null)"
      snap_cache_create="$(echo "$usage" | jq '(.cache_creation_input_tokens // 0)' 2>/dev/null)"
      snap_cache_read="$(echo "$usage" | jq '(.cache_read_input_tokens // 0)' 2>/dev/null)"
    else
      snap_input="$tokens"
      snap_cache_create="0"
      snap_cache_read="0"
    fi
    snap_remaining="${ctx_pct:-0}"
    printf '{"v":1,"event":"context.snapshot","session":"%s","ts":"%s","meta":{"model":"%s","input_tokens":"%s","cache_creation_tokens":"%s","cache_read_tokens":"%s","context_window_size":"%s","remaining_pct":"%s","claude_id":"%s"}}\n' \
      "$name" "$snap_ts" "$model" "$snap_input" "$snap_cache_create" "$snap_cache_read" "$ctx_size" "$snap_remaining" "$cid" \
      >> "$HOME/.bertrand/sessions/$name/log.jsonl"
    printf '{"v":1,"event":"context.snapshot","session":"%s","ts":"%s","meta":{"model":"%s","input_tokens":"%s","cache_creation_tokens":"%s","cache_read_tokens":"%s","context_window_size":"%s","remaining_pct":"%s","claude_id":"%s"}}\n' \
      "$name" "$snap_ts" "$model" "$snap_input" "$snap_cache_create" "$snap_cache_read" "$ctx_size" "$snap_remaining" "$cid" \
      >> "$HOME/.bertrand/log.jsonl"
  fi
fi

# ── Render ──
# Line 1: session name + status + siblings
printf '%s%s%s' "$c_name" "$name" "$c_rst"
[ -n "$dot" ] && printf '  %s' "$dot"
if [ "$siblings" -gt 0 ]; then
  s_label="siblings"
  [ "$siblings" -eq 1 ] && s_label="sibling"
  printf '  %s%d %s%s' "$c_dim" "$siblings" "$s_label" "$c_rst"
fi

# Line 2: model + context + duration + conversations
printf '\n%s%s%s' "$c_val" "$model" "$c_rst"
if [ -n "$ctx_pct" ]; then
  printf '  %sctx %s%s%%%s' "$c_dim" "$ctx_color" "$ctx_pct" "$c_rst"
fi
[ -n "$duration" ] && printf '  %s%s%s' "$c_dim" "$duration" "$c_rst"
if [ -n "$convs" ] && [ "$convs" -gt 1 ] 2>/dev/null; then
  printf '  %sconv %s%s' "$c_dim" "$convs" "$c_rst"
fi
printf '\n'
`
}

// StatuslineSettingsJSON returns a JSON string suitable for claude's --settings flag.
// This scopes the statusline override to the current session without modifying global settings.
func StatuslineSettingsJSON() string {
	cmd := filepath.Join(session.BaseDir(), "hooks", "statusline.sh")
	return fmt.Sprintf(`{"statusLine":{"type":"command","command":"%s","padding":0}}`, cmd)
}

// hooksFingerprint returns a SHA-256 hash of all hook script contents.
// Used to detect when installed hooks are outdated.
func hooksFingerprint() string {
	h := sha256.New()
	h.Write([]byte(BlockedScript()))
	h.Write([]byte(ResumedScript()))
	h.Write([]byte(PermissionWaitScript()))
	h.Write([]byte(PermissionDoneScript()))
	h.Write([]byte(WorktreeEnteredScript()))
	h.Write([]byte(WorktreeExitedScript()))
	h.Write([]byte(GhCommandScript()))
	h.Write([]byte(LinearReadScript()))
	h.Write([]byte(StatuslineScript()))
	return fmt.Sprintf("%x", h.Sum(nil))[:16]
}

// HooksStale returns true if installed hooks don't match the current version.
func HooksStale() bool {
	versionPath := filepath.Join(session.BaseDir(), "hooks", ".version")
	data, err := os.ReadFile(versionPath)
	if err != nil {
		return true // no version file → stale
	}
	return strings.TrimSpace(string(data)) != hooksFingerprint()
}

// InstallHooks writes hook scripts to ~/.bertrand/hooks/ and returns the path.
func InstallHooks() (string, error) {
	dir := filepath.Join(session.BaseDir(), "hooks")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}

	scripts := map[string]string{
		"on-blocked.sh":           BlockedScript(),
		"on-resumed.sh":           ResumedScript(),
		"on-permission-wait.sh":   PermissionWaitScript(),
		"on-permission-done.sh":   PermissionDoneScript(),
		"on-worktree-entered.sh":  WorktreeEnteredScript(),
		"on-worktree-exited.sh":   WorktreeExitedScript(),
		"on-gh-command.sh":        GhCommandScript(),
		"on-linear-read.sh":       LinearReadScript(),
		"statusline.sh":           StatuslineScript(),
	}

	for name, content := range scripts {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte(content), 0755); err != nil {
			return "", err
		}
	}

	// Write version fingerprint
	versionPath := filepath.Join(dir, ".version")
	if err := os.WriteFile(versionPath, []byte(hooksFingerprint()+"\n"), 0644); err != nil {
		return "", err
	}

	return dir, nil
}

type hookEntry struct {
	Type    string `json:"type"`
	Command string `json:"command"`
	Timeout int    `json:"timeout"`
}

type hookMatcher struct {
	Matcher string      `json:"matcher"`
	Hooks   []hookEntry `json:"hooks"`
}

// isBertrandHook checks if a hook command references a bertrand hook script.
func isBertrandHook(command string) bool {
	return strings.Contains(command, ".bertrand/hooks/")
}

// InjectSettings adds bertrand hooks to Claude Code's settings.json.
// It preserves existing non-bertrand hook entries for each event.
func InjectSettings() error {
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.Getenv("HOME")
	}
	settingsPath := filepath.Join(home, ".claude", "settings.json")

	var settings map[string]interface{}

	data, err := os.ReadFile(settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			settings = make(map[string]interface{})
		} else {
			return err
		}
	} else {
		if err := json.Unmarshal(data, &settings); err != nil {
			return err
		}
	}

	hooksDir := filepath.Join(session.BaseDir(), "hooks")

	bertrandHooks := map[string][]hookMatcher{
		"PreToolUse": {
			{
				Matcher: "AskUserQuestion",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-blocked.sh"),
						Timeout: 5,
					},
				},
			},
		},
		"PostToolUse": {
			{
				Matcher: "AskUserQuestion",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-resumed.sh"),
						Timeout: 5,
					},
				},
			},
			{
				Matcher: "EnterWorktree",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-worktree-entered.sh"),
						Timeout: 5,
					},
				},
			},
			{
				Matcher: "ExitWorktree",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-worktree-exited.sh"),
						Timeout: 5,
					},
				},
			},
			{
				Matcher: "Bash",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-gh-command.sh"),
						Timeout: 5,
					},
				},
			},
			{
				Matcher: "mcp__claude_ai_Linear__get_issue",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-linear-read.sh"),
						Timeout: 5,
					},
				},
			},
			{
				Matcher: "mcp__claude_ai_Linear__save_issue",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-linear-read.sh"),
						Timeout: 5,
					},
				},
			},
			{
				Matcher: "mcp__claude_ai_Linear__list_issues",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-linear-read.sh"),
						Timeout: 5,
					},
				},
			},
			{
				Matcher: "",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-permission-done.sh"),
						Timeout: 5,
					},
				},
			},
		},
		"PermissionRequest": {
			{
				Matcher: "",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-permission-wait.sh"),
						Timeout: 5,
					},
				},
			},
		},
	}

	existingHooks, _ := settings["hooks"].(map[string]interface{})
	if existingHooks == nil {
		existingHooks = make(map[string]interface{})
	}

	for event, newMatchers := range bertrandHooks {
		// Preserve existing non-bertrand hooks for this event
		var kept []hookMatcher
		if existing, ok := existingHooks[event]; ok {
			raw, _ := json.Marshal(existing)
			var existingMatchers []hookMatcher
			if json.Unmarshal(raw, &existingMatchers) == nil {
				for _, m := range existingMatchers {
					isBertrand := false
					for _, h := range m.Hooks {
						if isBertrandHook(h.Command) {
							isBertrand = true
							break
						}
					}
					if !isBertrand {
						kept = append(kept, m)
					}
				}
			}
		}
		existingHooks[event] = append(kept, newMatchers...)
	}
	settings["hooks"] = existingHooks

	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(settingsPath), 0755); err != nil {
		return err
	}
	return os.WriteFile(settingsPath, append(out, '\n'), 0644)
}

// RemoveSettings removes only bertrand hooks from Claude Code's settings.json,
// preserving any user-configured hooks.
func RemoveSettings() error {
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.Getenv("HOME")
	}
	settingsPath := filepath.Join(home, ".claude", "settings.json")

	data, err := os.ReadFile(settingsPath)
	if err != nil {
		return nil // nothing to remove
	}

	var settings map[string]interface{}
	if err := json.Unmarshal(data, &settings); err != nil {
		return err
	}

	existingHooks, ok := settings["hooks"].(map[string]interface{})
	if !ok {
		return nil
	}

	for _, event := range []string{"PreToolUse", "PostToolUse", "PermissionRequest"} {
		matchers, ok := existingHooks[event]
		if !ok {
			continue
		}
		raw, _ := json.Marshal(matchers)
		var parsed []hookMatcher
		if json.Unmarshal(raw, &parsed) != nil {
			continue
		}
		// Keep only non-bertrand matchers
		var kept []hookMatcher
		for _, m := range parsed {
			isBertrand := false
			for _, h := range m.Hooks {
				if isBertrandHook(h.Command) {
					isBertrand = true
					break
				}
			}
			if !isBertrand {
				kept = append(kept, m)
			}
		}
		if len(kept) == 0 {
			delete(existingHooks, event)
		} else {
			existingHooks[event] = kept
		}
	}

	if len(existingHooks) == 0 {
		delete(settings, "hooks")
	} else {
		settings["hooks"] = existingHooks
	}


	out, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(settingsPath, append(out, '\n'), 0644)
}

// HammerspoonConfig returns the Lua config for bertrand's focus queue.
func HammerspoonConfig() string {
	return `-- bertrand: focus queue for Claude Code session management

local bertrand = {}

local baseDir = os.getenv("HOME") .. "/.bertrand"
local sessionsDir = baseDir .. "/sessions"
local tmpDir = baseDir .. "/tmp"

local windowMap = {}        -- windowId → sessionName
local sessionWindows = {}   -- sessionName → windowId
local queue = {}
local snapshotWin = nil
local watcher = nil
local pollTimer = nil
local cleanupTick = 0

-- Notification state
local activeNotifications = {}
local notifiedSessions = {}

-- Dim settings — read from ~/.bertrand/config.yaml, fall back to defaults
local DIM_ALL_WINDOWS = true
local DIM_OPACITY = 0.65
local dimFilter = nil
local dimmedWindows = {}        -- winId → true, tracks windows we've dimmed

local function loadDimSettings()
  local f = io.open(baseDir .. "/config.yaml", "r")
  if not f then return end
  local content = f:read("*a")
  f:close()
  local allVal = content:match("dim_all_windows:%s*(%S+)")
  if allVal == "false" then DIM_ALL_WINDOWS = false
  elseif allVal == "true" then DIM_ALL_WINDOWS = true end
  local opVal = content:match("dim_opacity:%s*([%d%.]+)")
  if opVal then
    local n = tonumber(opVal)
    if n and n >= 0 and n <= 1 then DIM_OPACITY = n end
  end
end

-- Cache the Warp window filter (creating it is expensive)
local warpFilter = nil
local function getWarpFilter()
  if not warpFilter then
    warpFilter = hs.window.filter.new("Warp")
  end
  return warpFilter
end

-- Warp app icon for notifications
local warpIcon = nil
local function getWarpIcon()
  if not warpIcon then
    local app = hs.application.find("Warp")
    if app then
      warpIcon = hs.image.imageFromAppBundle(app:bundleID())
    end
  end
  return warpIcon
end

-- Dim unfocused windows (uses setAlpha, no canvas needed)
local function isBertrandWindow(win)
  return windowMap[win:id()] ~= nil
end

local function updateDim()
  local focused = hs.window.focusedWindow()
  local focusedId = focused and focused:id() or nil

  if DIM_ALL_WINDOWS then
    -- Dim all visible windows except the focused one
    local allWindows = hs.window.allWindows()
    for _, win in ipairs(allWindows) do
      local wid = win:id()
      if wid ~= focusedId then
        win:setAlpha(DIM_OPACITY)
        dimmedWindows[wid] = true
      else
        win:setAlpha(1.0)
        dimmedWindows[wid] = nil
      end
    end
  else
    -- Dim only bertrand-registered windows
    for winId, _ in pairs(windowMap) do
      local win = hs.window.get(winId)
      if win then
        if winId ~= focusedId then
          win:setAlpha(DIM_OPACITY)
          dimmedWindows[winId] = true
        else
          win:setAlpha(1.0)
          dimmedWindows[winId] = nil
        end
      end
    end
  end
end

local function restoreAllAlpha()
  for winId, _ in pairs(dimmedWindows) do
    local win = hs.window.get(winId)
    if win then win:setAlpha(1.0) end
  end
  dimmedWindows = {}
  -- Also restore any bertrand windows just in case
  for winId, _ in pairs(windowMap) do
    local win = hs.window.get(winId)
    if win then win:setAlpha(1.0) end
  end
end

local registrationsPath = tmpDir .. "/registrations.json"

local function readJSON(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local content = f:read("*a")
  f:close()
  local ok, data = pcall(hs.json.decode, content)
  if ok then return data end
  return nil
end

local function saveRegistrations()
  local data = {}
  for sessionName, winId in pairs(sessionWindows) do
    data[sessionName] = winId
  end
  local ok, json = pcall(hs.json.encode, data)
  if ok then
    local f = io.open(registrationsPath, "w")
    if f then f:write(json); f:close() end
  end
end

local function loadRegistrations()
  local data = readJSON(registrationsPath)
  if not data then return end
  for sessionName, winId in pairs(data) do
    local win = hs.window.get(winId)
    if win and win:application():name() == "Warp" then
      windowMap[winId] = sessionName
      sessionWindows[sessionName] = winId
      print("bertrand: restored " .. sessionName .. " → window " .. winId)
    end
  end
end

-- Focus a session's registered window, or fall back to any Warp window
local function focusSessionWindow(sessionName)
  local winId = sessionWindows[sessionName]
  if winId then
    local win = hs.window.get(winId)
    if win then
      win:focus()
      return true
    end
  end
  -- Fallback: focus any Warp window
  local warpWindows = getWarpFilter():getWindows()
  if #warpWindows > 0 then
    warpWindows[1]:focus()
    return true
  end
  return false
end

local function notifyBlocked(sessionName, summary)
  if notifiedSessions[sessionName] then return end
  -- Strip the "sessionName » " prefix from the summary since subTitle already shows it
  local prefix = sessionName .. " » "
  if summary:sub(1, #prefix) == prefix then
    summary = summary:sub(#prefix + 1)
  end

  local function sendNotification()
    local ok, n = pcall(hs.notify.new, function(notif)
      focusSessionWindow(sessionName)
      -- Withdraw after user clicks (action or notification body)
      if notif then notif:withdraw() end
      activeNotifications[sessionName] = nil
      notifiedSessions[sessionName] = nil
    end, {
      title = "bertrand",
      subTitle = sessionName,
      informativeText = summary,
      hasActionButton = true,
      actionButtonTitle = "Focus",
      autoWithdraw = false,
      withdrawAfter = 0,
    })
    if not ok or not n then
      print("bertrand: ERROR creating notification for " .. sessionName .. ": " .. tostring(n))
      return nil
    end
    local icon = getWarpIcon()
    if icon then n:setIdImage(icon) end
    local sendOk, sendErr = pcall(function() n:send() end)
    if not sendOk then
      print("bertrand: ERROR sending notification for " .. sessionName .. ": " .. tostring(sendErr))
      return nil
    end
    -- Verify notification was actually delivered
    local presented = n:presented()
    if not presented then
      print("bertrand: WARN notification not presented for " .. sessionName .. ", will retry")
      return nil
    end
    print("bertrand: notification sent for " .. sessionName)
    return n
  end

  local n = sendNotification()
  if not n then
    -- Retry once after a short delay
    hs.timer.doAfter(0.5, function()
      if notifiedSessions[sessionName] then return end
      print("bertrand: retrying notification for " .. sessionName)
      local retryN = sendNotification()
      if retryN then
        activeNotifications[sessionName] = retryN
        notifiedSessions[sessionName] = true
      else
        print("bertrand: FAILED notification retry for " .. sessionName)
        -- Mark as notified anyway to avoid infinite retry loops
        notifiedSessions[sessionName] = true
      end
    end)
    return
  end

  activeNotifications[sessionName] = n
  notifiedSessions[sessionName] = true

  local soundOk, soundErr = pcall(function()
    local s = hs.sound.getByName("Hero")
    if s then s:play() else print("bertrand: WARN 'Hero' sound not found") end
  end)
  if not soundOk then
    print("bertrand: ERROR playing sound: " .. tostring(soundErr))
  end
end

local function withdrawNotification(sessionName)
  local n = activeNotifications[sessionName]
  if n then
    n:withdraw()
    activeNotifications[sessionName] = nil
  end
  notifiedSessions[sessionName] = nil
end

local function processRegistrations()
  local iter, dir = hs.fs.dir(tmpDir)
  if not iter then return end

  for entry in iter, dir do
    if entry:sub(1, 9) == "register-" then
      local filePath = tmpDir .. "/" .. entry

      -- Read session name from file content (supports project/session format)
      local f = io.open(filePath, "r")
      local sessionName = f and f:read("*a") or nil
      if f then f:close() end
      if sessionName then sessionName = sessionName:match("^(.-)%s*$") end
      if not sessionName or sessionName == "" then
        os.remove(filePath)
      else
        if sessionWindows[sessionName] then
          windowMap[sessionWindows[sessionName]] = nil
        end

        local win = hs.window.focusedWindow()
        if not win or win:application():name() ~= "Warp" then
          win = nil
          local warpWindows = getWarpFilter():getWindows()
          for _, w in ipairs(warpWindows) do
            if not windowMap[w:id()] then
              win = w
              break
            end
          end
        end

        if win then
          local winId = win:id()
          windowMap[winId] = sessionName
          sessionWindows[sessionName] = winId
          print("bertrand: registered " .. sessionName .. " → window " .. winId)
        else
          print("bertrand: no Warp window found for " .. sessionName)
        end

        os.remove(filePath)
      end
    end
  end
  saveRegistrations()
end

local function refreshQueue()
  -- Stale cleanup only every 10 ticks (~5s at 0.5s interval)
  cleanupTick = cleanupTick + 1
  local isCleanupTick = cleanupTick >= 10
  if isCleanupTick then
    cleanupTick = 0
    local changed = false
    for winId, sessionName in pairs(windowMap) do
      if not hs.window.get(winId) then
        windowMap[winId] = nil
        if sessionWindows[sessionName] == winId then
          sessionWindows[sessionName] = nil
        end
        changed = true
      end
    end
    if changed then saveRegistrations() end
  end

  local wasEmpty = #queue == 0
  local previousFirst = queue[1] and queue[1].session or nil
  queue = {}

  local currentlyBlocked = {}

  -- Two-level scan: projects → sessions
  local pIter, pDir = hs.fs.dir(sessionsDir)
  if not pIter then return end

  for project in pIter, pDir do
    if project ~= "." and project ~= ".." then
      local projectPath = sessionsDir .. "/" .. project
      local pAttrs = hs.fs.attributes(projectPath)
      if pAttrs and pAttrs.mode == "directory" then
        local sIter, sDir = hs.fs.dir(projectPath)
        if sIter then
          for sess in sIter, sDir do
            if sess ~= "." and sess ~= ".." then
              local sessAttrs = hs.fs.attributes(projectPath .. "/" .. sess)
              if sessAttrs and sessAttrs.mode == "directory" then
                local fullName = project .. "/" .. sess
                local sessPath = projectPath .. "/" .. sess
                local state = readJSON(sessPath .. "/state.json")

                if state and state.status == "blocked" then
                  currentlyBlocked[fullName] = true
                  table.insert(queue, {
                    session = fullName,
                    timestamp = state.timestamp or "",
                    summary = state.summary or "Waiting for input",
                  })
                end

                -- Check for pending permission marker (PermissionRequest hook only)
                if state and state.status == "working" and not currentlyBlocked[fullName] then
                  local pendingPath = sessPath .. "/pending"
                  local pf = io.open(pendingPath, "r")
                  if pf then
                    local toolName = pf:read("*a") or "tool"
                    pf:close()
                    currentlyBlocked[fullName] = true
                    table.insert(queue, {
                      session = fullName,
                      timestamp = state.timestamp or "",
                      summary = "Waiting for permission: " .. toolName,
                    })
                  end
                end
              end
            end
          end
        end
      end
    end
  end

  -- Withdraw in-memory notifications for sessions no longer blocked
  for sessionName, _ in pairs(notifiedSessions) do
    if not currentlyBlocked[sessionName] then
      withdrawNotification(sessionName)
    end
  end

  -- Reconcile delivered OS notifications against actual session state (~5s)
  -- Catches orphans missed by in-memory tracking (e.g. after partial reload)
  if isCleanupTick then
    local delivered = hs.notify.deliveredNotifications() or {}
    for _, n in ipairs(delivered) do
      if n:title() == "bertrand" then
        local sess = n:subTitle()
        if sess and not currentlyBlocked[sess] then
          n:withdraw()
        end
      end
    end
  end

  table.sort(queue, function(a, b)
    return a.timestamp < b.timestamp
  end)

  if #queue > 0 and wasEmpty then
    local focusedWin = hs.window.focusedWindow()
    if focusedWin then
      snapshotWin = focusedWin
    end
    -- Notify first, then focus
    for _, item in ipairs(queue) do
      notifyBlocked(item.session, item.summary)
    end
    focusSessionWindow(queue[1].session)

  elseif #queue > 0 and queue[1].session ~= previousFirst then
    notifyBlocked(queue[1].session, queue[1].summary)
    focusSessionWindow(queue[1].session)

  elseif #queue == 0 and not wasEmpty then
    if snapshotWin then
      if snapshotWin:application() then
        snapshotWin:focus()
        print("bertrand: queue empty, restored " .. snapshotWin:application():name() .. " window")
      else
        print("bertrand: queue empty, snapshot window was closed")
      end
      snapshotWin = nil
    end
  end
end

-- Window layout helpers
local function getRegisteredWindows()
  local windows = {}
  for winId, _ in pairs(windowMap) do
    local win = hs.window.get(winId)
    if win then table.insert(windows, win) end
  end
  return windows
end

local function raiseAll(windows)
  for i = #windows, 1, -1 do windows[i]:raise() end
end

local function tileWindows()
  local windows = getRegisteredWindows()
  if #windows == 0 then return end
  local screen = hs.screen.mainScreen():frame()
  local gap = 8
  local cols = math.ceil(math.sqrt(#windows))
  local rows = math.ceil(#windows / cols)
  local cellW = math.floor((screen.w - gap * (cols + 1)) / cols)
  local cellH = math.floor((screen.h - gap * (rows + 1)) / rows)
  raiseAll(windows)
  for i, win in ipairs(windows) do
    local col = (i - 1) % cols
    local row = math.floor((i - 1) / cols)
    win:setFrame(hs.geometry.rect(
      screen.x + gap + col * (cellW + gap),
      screen.y + gap + row * (cellH + gap),
      cellW, cellH))
  end
  local f = io.open(tmpDir .. "/ack-tile", "w")
  if f then f:write("done"); f:close() end
end

local function cascadeWindows()
  local windows = getRegisteredWindows()
  if #windows == 0 then return end
  local screen = hs.screen.mainScreen():frame()
  local winW = math.floor(screen.w * 0.7)
  local winH = math.floor(screen.h * 0.75)
  local maxOff = math.min(screen.w - winW - 32, screen.h - winH - 32)
  local step = math.min(32, math.floor(maxOff / math.max(#windows - 1, 1)))
  raiseAll(windows)
  for i, win in ipairs(windows) do
    win:setFrame(hs.geometry.rect(
      screen.x + (i - 1) * step,
      screen.y + (i - 1) * step,
      winW, winH))
  end
  local f = io.open(tmpDir .. "/ack-cascade", "w")
  if f then f:write("done"); f:close() end
end

local function processSignals()
  local signals = { ["signal-tile"] = tileWindows, ["signal-cascade"] = cascadeWindows }
  for name, fn in pairs(signals) do
    local path = tmpDir .. "/" .. name
    local f = io.open(path, "r")
    if f then
      f:close()
      os.remove(path)
      fn()
    end
  end
end

local function onChange(paths, flags)
  processRegistrations()
  processSignals()
  refreshQueue()
end

function bertrand.start()
  os.execute("mkdir -p " .. tmpDir)
  os.execute("mkdir -p " .. sessionsDir)
  loadDimSettings()

  -- Purge stale notifications left by a previous Hammerspoon session
  local delivered = hs.notify.deliveredNotifications() or {}
  local purged = 0
  for _, n in ipairs(delivered) do
    if n:title() == "bertrand" then
      n:withdraw()
      purged = purged + 1
    end
  end
  if purged > 0 then
    print("bertrand: purged " .. purged .. " stale notification(s) from previous session")
  end

  loadRegistrations()
  watcher = hs.pathwatcher.new(baseDir, onChange)
  watcher:start()
  pollTimer = hs.timer.doEvery(0.5, function()
    processRegistrations()
    processSignals()
    refreshQueue()
  end)
  -- Dim unfocused windows on focus change
  dimFilter = hs.window.filter.new(nil)
  dimFilter:subscribe(
    { hs.window.filter.windowFocused, hs.window.filter.windowUnfocused },
    function() updateDim() end
  )
  updateDim()
  print("bertrand: watching " .. baseDir)
end

function bertrand.stop()
  if watcher then watcher:stop() end
  if pollTimer then pollTimer:stop() end
  -- Restore all dimmed windows to full opacity
  restoreAllAlpha()
  if dimFilter then dimFilter:unsubscribeAll(); dimFilter = nil end
  for sn, _ in pairs(activeNotifications) do withdrawNotification(sn) end
  windowMap = {}
  sessionWindows = {}
  queue = {}
  snapshotWin = nil
  warpFilter = nil
  warpIcon = nil
  print("bertrand: stopped")
end

return bertrand
`
}
