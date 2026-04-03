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
name="${BERTRAND_SESSION:-}"
[ -z "$name" ] && exit 0

input="$(cat)"
raw="$(printf '%s' "$input" | grep -o '"question"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"question"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"
# Strip "sessionName » " or "bertrand:sessionName > " prefix
# Use | delimiter — session names contain / which breaks s///
summary="$(printf '%s' "$raw" | sed "s|^${name} [^a-zA-Z]* ||" | sed "s|^bertrand:${name} > ||" | cut -c1-80)"
[ -z "$summary" ] && summary="Waiting for input"

bertrand update --name "$name" --status blocked --summary "$summary"

# Wave badge + notification (skip if wsh not available)
if command -v wsh &>/dev/null; then
  wsh badge message-question --color '#e0b956' --priority 20 --beep
  wsh notify -t "$name" "$summary"
fi

# Log event
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
esc_summary="$(printf '%s' "$summary" | sed 's/\\/\\\\/g; s/"/\\"/g')"
printf '{"v":1,"event":"session.block","session":"%s","ts":"%s","meta":{"question":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$esc_summary" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"session.block","session":"%s","ts":"%s","meta":{"question":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$esc_summary" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// WorkingScript returns the hook script that flips prompting → working
// on any PreToolUse (catch-all). This fires when Claude starts executing
// after the user answered at the text prompt.
func WorkingScript() string {
	return `#!/usr/bin/env bash
# Hook: PreToolUse (catch-all) → flip prompting to working
name="${BERTRAND_SESSION:-}"
[ -z "$name" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"

# AskUserQuestion has its own PreToolUse hook (blocked), skip it here
[ "$tool" = "AskUserQuestion" ] && exit 0

# Only flip if currently prompting
state_file="$HOME/.bertrand/sessions/$name/state.json"
[ ! -f "$state_file" ] && exit 0
status="$(grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' "$state_file" | head -1 | sed 's/.*"status"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"
[ "$status" != "prompting" ] && exit 0

bertrand update --name "$name" --status working --summary "Working"
`
}

func ResumedScript() string {
	return `#!/usr/bin/env bash
# Hook: PostToolUse AskUserQuestion → mark session as working, cycle focus to next blocked
name="${BERTRAND_SESSION:-}"
[ -z "$name" ] && exit 0

input="$(cat)"

bertrand update --name "$name" --status prompting --summary "Resumed after input"

# Extract user answer + notes from PostToolUse payload (python3 for reliable JSON parsing)
# tool_response is a string like: "User has answered your questions: \"q\"=\"a\". ..."
# tool_input.answers is a dict like: {"question": "answer"} (filled by permission component)
answer=""
if command -v python3 &>/dev/null; then
  answer="$(printf '%s' "$input" | python3 -c "
import json, sys, re
try:
    d = json.load(sys.stdin)
    # Method 1: tool_input.answers (structured data from permission component)
    ti = d.get('tool_input', {})
    if isinstance(ti, dict):
        ans = ti.get('answers', {})
        if isinstance(ans, dict) and ans:
            print(', '.join(str(v) for v in ans.values())[:200])
            sys.exit(0)
    # Method 2: tool_response as dict with answers
    tr = d.get('tool_response', {})
    if isinstance(tr, dict):
        ans = tr.get('answers', {})
        if isinstance(ans, dict) and ans:
            print(', '.join(str(v) for v in ans.values())[:200])
            sys.exit(0)
    # Method 3: tool_response as string — parse answer from formatted text
    if isinstance(tr, str):
        # Extract answers from '\"question\"=\"answer\"' patterns
        vals = re.findall(r'\"=\"([^\"]*?)\"', tr)
        if not vals:
            # Try unescaped: "question"="answer"
            vals = re.findall(r'\"=\"([^\"]*)\"', tr)
        # Also capture user notes if present
        notes = ''
        nm = re.search(r'user notes:\s*(.+?)(?:\.\s*You can now|\s*$)', tr, re.DOTALL)
        if nm:
            notes = nm.group(1).strip()
        parts = [v for v in vals if v] + ([notes] if notes else [])
        if parts:
            print(', '.join(parts)[:200])
            sys.exit(0)
except Exception:
    pass
" 2>/dev/null)"
fi

# Clear badge (skip if wsh not available)
if command -v wsh &>/dev/null; then
  wsh badge --clear
fi

# Log event — use python3 for JSON-safe escaping (handles newlines, control chars)
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
if command -v python3 &>/dev/null; then
  export NAME="$name" TS="$ts" CID="$cid"
  printf '%s' "$answer" | python3 -c "
import json, sys, os
a = sys.stdin.read()
obj = {'v':1,'event':'session.resume','session':os.environ['NAME'],'ts':os.environ['TS'],'meta':{'answer':a,'claude_id':os.environ['CID']}}
print(json.dumps(obj, ensure_ascii=False))
" 2>/dev/null | tee -a "$HOME/.bertrand/sessions/$name/log.jsonl" >> "$HOME/.bertrand/log.jsonl"
else
  esc_answer="$(printf '%s' "$answer" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  printf '{"v":1,"event":"session.resume","session":"%s","ts":"%s","meta":{"answer":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$esc_answer" "$cid" | tee -a "$HOME/.bertrand/sessions/$name/log.jsonl" >> "$HOME/.bertrand/log.jsonl"
fi
`
}

// extractDetailSnippet returns a shell snippet that extracts a detail string
// from the hook's $input JSON based on the tool name in $tool.
// Shared by PermissionWaitScript and PermissionDoneScript.
func extractDetailSnippet() string {
	return `# Extract detail from tool_input for richer timeline
detail=""
case "$tool" in
  Bash)
    detail="$(printf '%s' "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' | cut -c1-80)"
    ;;
  Edit|Write|Read)
    detail="$(printf '%s' "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' | cut -c1-80)"
    ;;
esac
esc_detail="$(printf '%s' "$detail" | sed 's/\\/\\\\/g; s/"/\\"/g')"
`
}

// PermissionWaitScript returns the hook script that writes a pending marker
// when a real permission dialog is shown (PermissionRequest event). This only
// fires when the user is actually prompted — auto-approved tools never trigger it.
func PermissionWaitScript() string {
	return `#!/usr/bin/env bash
# Hook: PermissionRequest (all tools) → write pending marker for real permission prompts
name="${BERTRAND_SESSION:-}"
[ -z "$name" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"

# AskUserQuestion has its own hook (blocked) — skip permission pipeline entirely
[ "$tool" = "AskUserQuestion" ] && exit 0

` + extractDetailSnippet() + `
# Write pending marker — this hook only fires for real permission prompts
mkdir -p "$HOME/.bertrand/sessions/$name" 2>/dev/null
printf '%s' "$tool" > "$HOME/.bertrand/sessions/$name/pending"

# Wave badge + notification (priority 25 > blocked's 20, skip if wsh not available)
if command -v wsh &>/dev/null; then
  wsh badge bell-exclamation --color '#ff6b35' --priority 25 --beep
  wsh notify -t "$name" "Needs permission: $tool"
fi

# Log event
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
printf '{"v":1,"event":"permission.request","session":"%s","ts":"%s","meta":{"tool":"%s","detail":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$tool" "$esc_detail" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"permission.request","session":"%s","ts":"%s","meta":{"tool":"%s","detail":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$tool" "$esc_detail" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// PermissionDoneScript returns the hook script that removes the pending marker
// when any tool (except AskUserQuestion) completes via PostToolUse.
func PermissionDoneScript() string {
	return `#!/usr/bin/env bash
# Hook: PostToolUse (all tools) → remove pending marker + track focus
name="${BERTRAND_SESSION:-}"
[ -z "$name" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"

# Skip tools that are always auto-approved (no permission prompt)
case "$tool" in
  AskUserQuestion|Read|Glob|Grep|ToolSearch) exit 0 ;;
esac

` + extractDetailSnippet() + `
had_pending=0
[ -f "$HOME/.bertrand/sessions/$name/pending" ] && had_pending=1
rm -f "$HOME/.bertrand/sessions/$name/pending"

# Clear permission badge if we had a pending prompt
if [ "$had_pending" -eq 1 ] && command -v wsh &>/dev/null; then
  wsh badge --clear
fi

# Log event
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
printf '{"v":1,"event":"permission.resolve","session":"%s","ts":"%s","meta":{"tool":"%s","detail":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$tool" "$esc_detail" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"permission.resolve","session":"%s","ts":"%s","meta":{"tool":"%s","detail":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$tool" "$esc_detail" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// DoneScript returns the hook script for the Stop event.
// Sets a green check badge and writes done status.
func DoneScript() string {
	return `#!/usr/bin/env bash
# Hook: Stop → mark session as paused, using agent summary if available
name="${BERTRAND_SESSION:-}"
[ -z "$name" ] && exit 0

summary="$(cat "$HOME/.bertrand/sessions/$name/summary" 2>/dev/null | head -1 | cut -c1-120)"
[ -z "$summary" ] && summary="Session ended"
bertrand update --name "$name" --status paused --summary "$summary"

# Wave badge (skip if wsh not available)
if command -v wsh &>/dev/null; then
  wsh badge check --color '#58c142' --priority 10
fi

# Log event
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
printf '{"v":1,"event":"session.paused","session":"%s","ts":"%s","meta":{"claude_id":"%s"}}\n' "$name" "$ts" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"session.paused","session":"%s","ts":"%s","meta":{"claude_id":"%s"}}\n' "$name" "$ts" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// WorktreeEnteredScript returns the hook script that writes a worktree marker
// when a session enters a git worktree via EnterWorktree.
func WorktreeEnteredScript() string {
	return `#!/usr/bin/env bash
# Hook: PostToolUse EnterWorktree → write worktree marker
name="${BERTRAND_SESSION:-}"
[ -z "$name" ] && exit 0

input="$(cat)"
# Extract branch name from tool output — best effort
branch="$(printf '%s' "$input" | grep -o 'branch [^ ]*' | head -1 | sed 's/branch //; s/[.,;:]$//')"
[ -z "$branch" ] && branch="unknown"
esc_branch="$(printf '%s' "$branch" | sed 's/\\/\\\\/g; s/"/\\"/g')"

# Extract worktree path from tool output — best effort
wt_path="$(printf '%s' "$input" | grep -o '/[^ ]*worktrees/[^ ]*' | head -1 | sed 's/[.,;:]$//')"

# Write worktree marker file (branch on line 1, path on line 2 if available)
mkdir -p "$HOME/.bertrand/sessions/$name" 2>/dev/null
if [ -n "$wt_path" ]; then
  printf '%s\n%s' "$branch" "$wt_path" > "$HOME/.bertrand/sessions/$name/worktree"
else
  printf '%s' "$branch" > "$HOME/.bertrand/sessions/$name/worktree"
fi

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
name="${BERTRAND_SESSION:-}"
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
name="${BERTRAND_SESSION:-}"
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
    # Extract PR title from --title flag in the command
    pr_title="$(printf '%s' "$cmd" | sed -n 's/.*--title[[:space:]]*"\([^"]*\)".*/\1/p' | cut -c1-120)"
    [ -z "$pr_number" ] && pr_number=""
    [ -z "$pr_url" ] && pr_url=""
    [ -z "$branch" ] && branch=""
    [ -z "$pr_title" ] && pr_title=""
    esc_title="$(printf '%s' "$pr_title" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    printf '{"v":1,"event":"gh.pr.created","session":"%s","ts":"%s","meta":{"pr_number":"%s","pr_url":"%s","branch":"%s","pr_title":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$pr_number" "$pr_url" "$branch" "$esc_title" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
    printf '{"v":1,"event":"gh.pr.created","session":"%s","ts":"%s","meta":{"pr_number":"%s","pr_url":"%s","branch":"%s","pr_title":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$pr_number" "$pr_url" "$branch" "$esc_title" "$cid" >> "$HOME/.bertrand/log.jsonl"
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
name="${BERTRAND_SESSION:-}"
[ -z "$name" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"

# Extract issue ID and title from the response via python3 JSON parsing
issue_id=""
esc_title=""
if command -v python3 &>/dev/null; then
  eval "$(printf '%s' "$input" | python3 -c "
import json, sys, re
try:
    d = json.load(sys.stdin)
    resp = d.get('tool_response', '')
    if isinstance(resp, str):
        try: resp = json.loads(resp)
        except: pass
    iid = ''
    ttl = ''
    if isinstance(resp, dict):
        raw_id = resp.get('id', '')
        if isinstance(raw_id, str) and re.match(r'^[A-Z]+-\d+$', raw_id):
            iid = raw_id
        ttl = resp.get('title', '') or ''
    if not iid:
        inp = d.get('tool_input', {})
        if isinstance(inp, dict):
            for k in ('id', 'issueId', 'issue_id'):
                v = inp.get(k, '')
                if isinstance(v, str) and re.match(r'^[A-Z]+-\d+$', v):
                    iid = v
                    break
    safe_id = iid.replace(chr(92), chr(92)*2).replace(chr(34), chr(92)+chr(34))
    safe_ttl = ttl[:80].replace(chr(92), chr(92)*2).replace(chr(34), chr(92)+chr(34))
    print('issue_id=' + chr(34) + safe_id + chr(34))
    print('esc_title=' + chr(34) + safe_ttl + chr(34))
except:
    print('issue_id=' + chr(34) + chr(34))
    print('esc_title=' + chr(34) + chr(34))
" 2>/dev/null)"
fi

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
printf '{"v":1,"event":"linear.issue.read","session":"%s","ts":"%s","meta":{"issue_id":"%s","issue_title":"%s","tool_name":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$issue_id" "$esc_title" "$tool" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"linear.issue.read","session":"%s","ts":"%s","meta":{"issue_id":"%s","issue_title":"%s","tool_name":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$issue_id" "$esc_title" "$tool" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// NotionReadScript returns the hook script that logs Notion MCP tool usage.
func NotionReadScript() string {
	return `#!/usr/bin/env bash
# Hook: PostToolUse mcp__claude_ai_Notion__* → log Notion page reads
name="${BERTRAND_SESSION:-}"
[ -z "$name" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"

page_id=""
page_title=""
page_url=""
if command -v python3 &>/dev/null; then
  eval "$(printf '%s' "$input" | python3 -c "
import json, sys, re
try:
    d = json.load(sys.stdin)
    inp = d.get('tool_input', {})
    resp = d.get('tool_response', '')
    if isinstance(resp, str):
        try: resp = json.loads(resp)
        except: pass
    pid = ''
    ttl = ''
    url = ''
    if isinstance(inp, dict):
        pid = inp.get('pageId', inp.get('page_id', '')) or ''
    if isinstance(resp, dict):
        ttl = resp.get('title', '') or ''
        url = resp.get('url', '') or ''
        if not pid:
            pid = resp.get('id', '') or ''
    safe = lambda s: s[:120].replace(chr(92), chr(92)*2).replace(chr(34), chr(92)+chr(34))
    print('page_id=' + chr(34) + safe(pid) + chr(34))
    print('page_title=' + chr(34) + safe(ttl) + chr(34))
    print('page_url=' + chr(34) + safe(url) + chr(34))
except:
    print('page_id=' + chr(34) + chr(34))
    print('page_title=' + chr(34) + chr(34))
    print('page_url=' + chr(34) + chr(34))
" 2>/dev/null)"
fi

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
esc_title="$(printf '%s' "$page_title" | sed 's/\\/\\\\/g; s/"/\\"/g')"
printf '{"v":1,"event":"notion.page.read","session":"%s","ts":"%s","meta":{"page_id":"%s","page_title":"%s","page_url":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$page_id" "$esc_title" "$page_url" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"notion.page.read","session":"%s","ts":"%s","meta":{"page_id":"%s","page_title":"%s","page_url":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$page_id" "$esc_title" "$page_url" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// VercelDeployScript returns the hook script that logs Vercel deployment commands.
func VercelDeployScript() string {
	return `#!/usr/bin/env bash
# Hook: PostToolUse Bash → detect vercel deploy commands
name="${BERTRAND_SESSION:-}"
[ -z "$name" ] && exit 0

input="$(cat)"
tool="$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"

# Only process Bash tool calls
[ "$tool" != "Bash" ] && exit 0

cmd="$(printf '%s' "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')"

# Only process vercel deploy commands
case "$cmd" in
  vercel\ deploy*|vercel\ --prod*|npx\ vercel\ deploy*|npx\ vercel\ --prod*) ;;
  *) exit 0 ;;
esac

# Extract deploy URL from response
deploy_url="$(printf '%s' "$input" | grep -oE 'https://[a-zA-Z0-9._-]+\.vercel\.app[^ "]*' | head -1)"
project_name="$(printf '%s' "$cmd" | sed -n 's/.*--name[[:space:]]*\([^ ]*\).*/\1/p')"
[ -z "$project_name" ] && project_name=""

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
printf '{"v":1,"event":"vercel.deploy","session":"%s","ts":"%s","meta":{"deploy_url":"%s","project_name":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$deploy_url" "$project_name" "$cid" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"v":1,"event":"vercel.deploy","session":"%s","ts":"%s","meta":{"deploy_url":"%s","project_name":"%s","claude_id":"%s"}}\n' "$name" "$ts" "$deploy_url" "$project_name" "$cid" >> "$HOME/.bertrand/log.jsonl"
`
}

// UserPromptScript returns the hook script that captures free-text user messages.
// Fires on UserPromptSubmit — when the user types a message outside the AskUserQuestion loop.
func UserPromptScript() string {
	return `#!/usr/bin/env bash
# Hook: UserPromptSubmit → capture free-text user message
name="${BERTRAND_SESSION:-}"
[ -z "$name" ] && exit 0

input="$(cat)"

# Extract prompt text from the hook input JSON
prompt=""
if command -v python3 &>/dev/null; then
  prompt="$(printf '%s' "$input" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    p = d.get('prompt', '')
    if p:
        print(p[:200])
except Exception:
    pass
" 2>/dev/null)"
fi

[ -z "$prompt" ] && exit 0

# Log event — use python3 for JSON-safe escaping
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cid="${BERTRAND_CLAUDE_ID:-}"
if command -v python3 &>/dev/null; then
  export NAME="$name" TS="$ts" CID="$cid"
  printf '%s' "$prompt" | python3 -c "
import json, sys, os
p = sys.stdin.read()
obj = {'v':1,'event':'user.prompt','session':os.environ['NAME'],'ts':os.environ['TS'],'meta':{'prompt':p,'claude_id':os.environ['CID']}}
print(json.dumps(obj, ensure_ascii=False))
" 2>/dev/null | tee -a "$HOME/.bertrand/sessions/$name/log.jsonl" >> "$HOME/.bertrand/log.jsonl"
fi
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
c_branch=$'\033[38;5;147m'   # lavender — branch name
c_add=$'\033[38;5;120m'      # green — additions
c_del=$'\033[38;5;203m'      # red — deletions
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
  working)   dot="${c_status}●${c_rst}" ;;
  blocked)   dot="${c_blocked}●${c_rst}" ;;
  prompting) dot="${c_val}●${c_rst}" ;;
  paused)    dot="${c_dim}●${c_rst}" ;;
  archived)  dot="${c_dim}○${c_rst}" ;;
  *)         dot="" ;;
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
    [ "$s" = "paused" ] || [ "$s" = "archived" ] || [ "$s" = "done" ] && continue
    [ -n "$spid" ] && [ "$spid" != "0" ] && kill -0 "$spid" 2>/dev/null && siblings=$((siblings + 1))
  done
fi

# Git info
branch=""
project=""
diff_stat=""
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch="$(git branch --show-current 2>/dev/null)"
  project="$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null)"
  # Diff summary: files changed, insertions, deletions
  diff_raw="$(git diff --shortstat 2>/dev/null)"
  if [ -n "$diff_raw" ]; then
    files="$(echo "$diff_raw" | grep -o '[0-9]* file' | grep -o '[0-9]*')"
    adds="$(echo "$diff_raw" | grep -o '[0-9]* insertion' | grep -o '[0-9]*')"
    dels="$(echo "$diff_raw" | grep -o '[0-9]* deletion' | grep -o '[0-9]*')"
    diff_stat=""
    [ -n "$files" ] && diff_stat="${files}f"
    [ -n "$adds" ] && diff_stat="${diff_stat:+$diff_stat }${c_add}+${adds}${c_rst}"
    [ -n "$dels" ] && diff_stat="${diff_stat:+$diff_stat }${c_del}-${dels}${c_rst}"
  fi
fi

# Claude JSON data — model + context
model=""
ctx_pct=""
if [ "$HAS_JQ" -eq 1 ]; then
  model="$(echo "$input" | jq -r '.model.display_name // ""' 2>/dev/null)"
  ctx_size="$(echo "$input" | jq -r '.context_window.context_window_size // 0' 2>/dev/null)"
  usage="$(echo "$input" | jq '.context_window.current_usage' 2>/dev/null)"
  if [ "$usage" != "null" ] && [ -n "$usage" ] && [ "$ctx_size" -gt 0 ] 2>/dev/null; then
    tokens="$(echo "$usage" | jq '(.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)' 2>/dev/null)"
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
  fi
fi

# Worktree detection (from Claude's JSON or bertrand marker)
worktree=""
if [ "$HAS_JQ" -eq 1 ]; then
  worktree="$(echo "$input" | jq -r '.worktree.branch // ""' 2>/dev/null)"
fi
[ -z "$worktree" ] && worktree="$(cat "$HOME/.bertrand/sessions/$name/worktree" 2>/dev/null)"

# ── Render ──
sep="${c_dim} │ ${c_rst}"

# Line 1: session name + status dot + siblings
printf '%s%s%s' "$c_name" "$name" "$c_rst"
[ -n "$dot" ] && printf '%s%s' "$sep" "$dot"
if [ "$siblings" -gt 0 ]; then
  s_label="siblings"
  [ "$siblings" -eq 1 ] && s_label="sibling"
  printf '%s%s%d %s%s' "$sep" "$c_dim" "$siblings" "$s_label" "$c_rst"
fi

# Line 2: project + branch/worktree + diff
printf '\n'
[ -n "$project" ] && printf '%s%s%s' "$c_val" "$project" "$c_rst"
if [ -n "$worktree" ]; then
  printf '%s%s⎇ %s%s' "$sep" "$c_branch" "$worktree" "$c_rst"
elif [ -n "$branch" ]; then
  printf '%s%s⎇ %s%s' "$sep" "$c_branch" "$branch" "$c_rst"
fi
[ -n "$diff_stat" ] && printf '%s%s' "$sep" "$diff_stat"

# Line 3: model + context
printf '\n'
[ -n "$model" ] && printf '%s%s%s' "$c_val" "$model" "$c_rst"
if [ -n "$ctx_pct" ]; then
  printf '%s%sctx %s%s%%%s' "$sep" "$c_dim" "$ctx_color" "$ctx_pct" "$c_rst"
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
	h.Write([]byte(WorkingScript()))
	h.Write([]byte(ResumedScript()))
	h.Write([]byte(PermissionWaitScript()))
	h.Write([]byte(PermissionDoneScript()))
	h.Write([]byte(DoneScript()))
	h.Write([]byte(WorktreeEnteredScript()))
	h.Write([]byte(WorktreeExitedScript()))
	h.Write([]byte(GhCommandScript()))
	h.Write([]byte(LinearReadScript()))
	h.Write([]byte(UserPromptScript()))
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
		"on-working.sh":           WorkingScript(),
		"on-resumed.sh":           ResumedScript(),
		"on-permission-wait.sh":   PermissionWaitScript(),
		"on-permission-done.sh":   PermissionDoneScript(),
		"on-done.sh":              DoneScript(),
		"on-worktree-entered.sh":  WorktreeEnteredScript(),
		"on-worktree-exited.sh":   WorktreeExitedScript(),
		"on-gh-command.sh":        GhCommandScript(),
		"on-linear-read.sh":       LinearReadScript(),
		"on-notion-read.sh":       NotionReadScript(),
		"on-vercel-deploy.sh":     VercelDeployScript(),
		"on-user-prompt.sh":       UserPromptScript(),
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
						Timeout: 10,
					},
				},
			},
			{
				Matcher: "",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-working.sh"),
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
						Timeout: 10,
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
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-vercel-deploy.sh"),
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
				Matcher: "mcp__claude_ai_Notion__notion-fetch",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-notion-read.sh"),
						Timeout: 5,
					},
				},
			},
			{
				Matcher: "mcp__claude_ai_Notion__notion-search",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-notion-read.sh"),
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
						Timeout: 10,
					},
				},
			},
		},
		"UserPromptSubmit": {
			{
				Matcher: "",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-user-prompt.sh"),
						Timeout: 5,
					},
				},
			},
		},
		"Stop": {
			{
				Matcher: "",
				Hooks: []hookEntry{
					{
						Type:    "command",
						Command: filepath.Join(hooksDir, "on-done.sh"),
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

	// Register bertrand MCP server
	binPath, _ := os.Executable()
	if binPath != "" {
		mcpServers, _ := settings["mcpServers"].(map[string]interface{})
		if mcpServers == nil {
			mcpServers = make(map[string]interface{})
		}
		mcpServers["bertrand"] = map[string]interface{}{
			"command": binPath,
			"args":    []string{"mcp"},
		}
		settings["mcpServers"] = mcpServers
	}

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

	for _, event := range []string{"PreToolUse", "PostToolUse", "PermissionRequest", "UserPromptSubmit", "Stop"} {
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

