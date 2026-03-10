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
