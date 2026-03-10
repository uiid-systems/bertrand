package hooks

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func withTempHome(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	os.MkdirAll(filepath.Join(dir, ".bertrand", "hooks"), 0755)
	os.MkdirAll(filepath.Join(dir, ".claude"), 0755)
	return dir
}

func TestInstallHooks(t *testing.T) {
	withTempHome(t)

	dir, err := InstallHooks()
	if err != nil {
		t.Fatalf("InstallHooks: %v", err)
	}

	expectedScripts := []string{
		"on-blocked.sh",
		"on-resumed.sh",
		"on-permission-wait.sh",
		"on-permission-done.sh",
	}

	for _, name := range expectedScripts {
		path := filepath.Join(dir, name)
		info, err := os.Stat(path)
		if err != nil {
			t.Errorf("missing hook script %s: %v", name, err)
			continue
		}
		if info.Mode().Perm()&0111 == 0 {
			t.Errorf("hook script %s is not executable", name)
		}
	}
}

func TestInjectSettings_CreatesNewFile(t *testing.T) {
	home := withTempHome(t)

	if err := InjectSettings(); err != nil {
		t.Fatalf("InjectSettings: %v", err)
	}

	settingsPath := filepath.Join(home, ".claude", "settings.json")
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("reading settings.json: %v", err)
	}

	var settings map[string]interface{}
	if err := json.Unmarshal(data, &settings); err != nil {
		t.Fatalf("parsing settings.json: %v", err)
	}

	hooks, ok := settings["hooks"].(map[string]interface{})
	if !ok {
		t.Fatal("settings.hooks is not a map")
	}

	if _, ok := hooks["PreToolUse"]; !ok {
		t.Error("missing PreToolUse hooks")
	}
	if _, ok := hooks["PostToolUse"]; !ok {
		t.Error("missing PostToolUse hooks")
	}
}

func TestInjectSettings_PreservesUserHooks(t *testing.T) {
	home := withTempHome(t)
	settingsPath := filepath.Join(home, ".claude", "settings.json")

	// Write existing settings with a user hook
	existing := map[string]interface{}{
		"hooks": map[string]interface{}{
			"PreToolUse": []hookMatcher{
				{
					Matcher: "Bash",
					Hooks: []hookEntry{
						{Type: "command", Command: "/usr/local/bin/my-custom-hook.sh", Timeout: 10},
					},
				},
			},
		},
	}
	data, _ := json.MarshalIndent(existing, "", "  ")
	os.WriteFile(settingsPath, data, 0644)

	if err := InjectSettings(); err != nil {
		t.Fatalf("InjectSettings: %v", err)
	}

	data, _ = os.ReadFile(settingsPath)
	var settings map[string]interface{}
	json.Unmarshal(data, &settings)

	hooks := settings["hooks"].(map[string]interface{})
	raw, _ := json.Marshal(hooks["PreToolUse"])
	var matchers []hookMatcher
	json.Unmarshal(raw, &matchers)

	// Should have user hook + 2 bertrand hooks = 3 total
	if len(matchers) != 3 {
		t.Errorf("expected 3 PreToolUse matchers (1 user + 2 bertrand), got %d", len(matchers))
	}

	// First should be the user hook (preserved)
	if matchers[0].Matcher != "Bash" {
		t.Errorf("first matcher should be user's Bash hook, got %q", matchers[0].Matcher)
	}
}

func TestInjectSettings_Idempotent(t *testing.T) {
	home := withTempHome(t)
	settingsPath := filepath.Join(home, ".claude", "settings.json")

	// Run twice
	InjectSettings()
	InjectSettings()

	data, _ := os.ReadFile(settingsPath)
	var settings map[string]interface{}
	json.Unmarshal(data, &settings)

	hooks := settings["hooks"].(map[string]interface{})
	raw, _ := json.Marshal(hooks["PreToolUse"])
	var matchers []hookMatcher
	json.Unmarshal(raw, &matchers)

	// Should still be exactly 2 bertrand hooks, not 4
	if len(matchers) != 2 {
		t.Errorf("expected 2 PreToolUse matchers after double inject, got %d", len(matchers))
	}
}

func TestRemoveSettings_PreservesUserHooks(t *testing.T) {
	home := withTempHome(t)
	settingsPath := filepath.Join(home, ".claude", "settings.json")

	// Inject bertrand hooks first
	InjectSettings()

	// Now manually add a user hook alongside bertrand
	data, _ := os.ReadFile(settingsPath)
	var settings map[string]interface{}
	json.Unmarshal(data, &settings)

	hooks := settings["hooks"].(map[string]interface{})
	raw, _ := json.Marshal(hooks["PreToolUse"])
	var matchers []hookMatcher
	json.Unmarshal(raw, &matchers)

	matchers = append(matchers, hookMatcher{
		Matcher: "Write",
		Hooks:   []hookEntry{{Type: "command", Command: "/usr/local/bin/user-hook.sh", Timeout: 5}},
	})
	hooks["PreToolUse"] = matchers
	out, _ := json.MarshalIndent(settings, "", "  ")
	os.WriteFile(settingsPath, out, 0644)

	// Remove bertrand hooks
	if err := RemoveSettings(); err != nil {
		t.Fatalf("RemoveSettings: %v", err)
	}

	data, _ = os.ReadFile(settingsPath)
	json.Unmarshal(data, &settings)
	hooks = settings["hooks"].(map[string]interface{})

	raw, _ = json.Marshal(hooks["PreToolUse"])
	json.Unmarshal(raw, &matchers)

	// Should only have the user hook left
	if len(matchers) != 1 {
		t.Errorf("expected 1 remaining PreToolUse matcher, got %d", len(matchers))
	}
	if matchers[0].Matcher != "Write" {
		t.Errorf("remaining matcher should be Write, got %q", matchers[0].Matcher)
	}

	// PostToolUse should be fully removed (no user hooks there)
	if _, ok := hooks["PostToolUse"]; ok {
		t.Error("PostToolUse should have been fully removed")
	}
}

func TestRemoveSettings_NoFile(t *testing.T) {
	withTempHome(t)

	// Should not error when settings file doesn't exist
	if err := RemoveSettings(); err != nil {
		t.Errorf("RemoveSettings with no file: %v", err)
	}
}

func TestBlockedScript_ExitTags(t *testing.T) {
	script := BlockedScript()

	// Should detect [SUMMARY], [DISCARD], and [EXIT] tags
	tags := []string{"[SUMMARY]", "[DISCARD]", "[EXIT]"}
	for _, tag := range tags {
		if !strings.Contains(script, tag) {
			t.Errorf("BlockedScript should detect %s tag", tag)
		}
	}

	// Should write summary hint file on [SUMMARY]
	if !strings.Contains(script, "$session_dir/summary") {
		t.Error("BlockedScript should write summary hint file")
	}

	// Should write discard hint file on [DISCARD]
	if !strings.Contains(script, "$session_dir/discard") {
		t.Error("BlockedScript should write discard hint file")
	}
}

func TestIsBertrandHook(t *testing.T) {
	tests := []struct {
		command string
		want    bool
	}{
		{"/Users/foo/.bertrand/hooks/on-blocked.sh", true},
		{"/usr/local/bin/my-hook.sh", false},
		{"", false},
	}

	for _, tt := range tests {
		if got := isBertrandHook(tt.command); got != tt.want {
			t.Errorf("isBertrandHook(%q) = %v, want %v", tt.command, got, tt.want)
		}
	}
}
