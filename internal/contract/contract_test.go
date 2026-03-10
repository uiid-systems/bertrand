package contract

import (
	"strings"
	"testing"
)

func TestTemplate(t *testing.T) {
	result := Template("my-session")

	if !strings.Contains(result, "session: my-session") {
		t.Error("template should contain session name in preamble")
	}

	if !strings.Contains(result, `"my-session »"`) {
		t.Error("template should contain session name in question prefix instruction")
	}

	// Session name should appear at least twice (preamble + question format)
	count := strings.Count(result, "my-session")
	if count < 2 {
		t.Errorf("expected session name to appear at least 2 times, got %d", count)
	}
}

func TestTemplate_ExitFlow(t *testing.T) {
	result := Template("test-session")

	// Should contain exit flow instructions
	exitTags := []string{
		"[EXIT] test-session »",
		"[SUMMARY] test-session »",
		"[DISCARD] test-session »",
	}
	for _, tag := range exitTags {
		if !strings.Contains(result, tag) {
			t.Errorf("template should contain %q", tag)
		}
	}

	// Should contain the three exit options
	exitOptions := []string{
		"Save and exit",
		"Discard and exit",
		"Drop to prompt",
	}
	for _, opt := range exitOptions {
		if !strings.Contains(result, opt) {
			t.Errorf("template should contain exit option %q", opt)
		}
	}

	// Should still have the "Done for now" instruction
	if !strings.Contains(result, "Done for now") {
		t.Error("template should still reference 'Done for now' as the trigger")
	}
}
