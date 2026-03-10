package hooks

import (
	"encoding/json"
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
summary="$(printf '%s' "$raw" | sed "s/^${name} [^a-zA-Z]* //" | sed "s/^bertrand:${name} > //" | cut -c1-80)"
[ -z "$summary" ] && summary="Waiting for input"

bertrand update --name "$name" --status blocked --summary "$summary"

# Log event
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
esc_summary="$(printf '%s' "$summary" | sed 's/\\/\\\\/g; s/"/\\"/g')"
printf '{"event":"session.block","session":"%s","ts":"%s","meta":{"question":"%s"}}\n' "$name" "$ts" "$esc_summary" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"event":"session.block","session":"%s","ts":"%s","meta":{"question":"%s"}}\n' "$name" "$ts" "$esc_summary" >> "$HOME/.bertrand/log.jsonl"
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
printf '{"event":"session.resume","session":"%s","ts":"%s"}\n' "$name" "$ts" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"event":"session.resume","session":"%s","ts":"%s"}\n' "$name" "$ts" >> "$HOME/.bertrand/log.jsonl"
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
printf '{"event":"permission.request","session":"%s","ts":"%s","meta":{"tool":"%s"}}\n' "$name" "$ts" "$tool" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"event":"permission.request","session":"%s","ts":"%s","meta":{"tool":"%s"}}\n' "$name" "$ts" "$tool" >> "$HOME/.bertrand/log.jsonl"
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
printf '{"event":"permission.resolve","session":"%s","ts":"%s","meta":{"tool":"%s"}}\n' "$name" "$ts" "$tool" >> "$HOME/.bertrand/sessions/$name/log.jsonl"
printf '{"event":"permission.resolve","session":"%s","ts":"%s","meta":{"tool":"%s"}}\n' "$name" "$ts" "$tool" >> "$HOME/.bertrand/log.jsonl"
`
}

// InstallHooks writes hook scripts to ~/.bertrand/hooks/ and returns the path.
func InstallHooks() (string, error) {
	dir := filepath.Join(session.BaseDir(), "hooks")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}

	scripts := map[string]string{
		"on-blocked.sh":         BlockedScript(),
		"on-resumed.sh":         ResumedScript(),
		"on-permission-wait.sh": PermissionWaitScript(),
		"on-permission-done.sh": PermissionDoneScript(),
	}

	for name, content := range scripts {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte(content), 0755); err != nil {
			return "", err
		}
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

-- Window border state (disabled — canvas causes HSCanvasWindow makeKeyWindow errors)
-- local borderCanvas = nil
-- local borderTimer = nil
-- local focusSub = nil
-- local BORDER_WIDTH = 4
-- local BORDER_COLOR = { red = 0, green = 1, blue = 0, alpha = 0.5 }

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

-- Border functions (disabled — canvas causes HSCanvasWindow makeKeyWindow errors)
local function showBorder(win) end
local function hideBorder() end
local function updateBorder() end

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
    local ok, n = pcall(hs.notify.new, function()
      focusSessionWindow(sessionName)
    end, {
      title = "bertrand",
      subTitle = sessionName,
      informativeText = summary,
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
  -- Stale cleanup only every 10 ticks
  cleanupTick = cleanupTick + 1
  if cleanupTick >= 10 then
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

  -- Reconcile delivered OS notifications against actual session state
  -- Catches orphans missed by in-memory tracking (e.g. after partial reload)
  local delivered = hs.notify.deliveredNotifications() or {}
  for _, n in ipairs(delivered) do
    if n:title() == "bertrand" then
      local sess = n:subTitle()
      if sess and not currentlyBlocked[sess] then
        n:withdraw()
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
  -- Border focus tracking (disabled — canvas causes HSCanvasWindow errors)
  -- focusSub = hs.window.filter.new(nil):subscribe(
  --   { hs.window.filter.windowFocused, hs.window.filter.windowUnfocused },
  --   function() updateBorder() end
  -- )
  print("bertrand: watching " .. baseDir)
end

function bertrand.stop()
  if watcher then watcher:stop() end
  if pollTimer then pollTimer:stop() end
  -- Border cleanup (disabled)
  -- if focusSub then focusSub:unsubscribeAll(); focusSub = nil end
  -- hideBorder()
  -- if borderCanvas then borderCanvas:delete(); borderCanvas = nil end
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
