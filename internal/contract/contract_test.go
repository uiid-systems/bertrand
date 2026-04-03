package contract

import (
	"strings"
	"testing"
)

func TestTemplate(t *testing.T) {
	result := Template("proj/my-session", "/tmp/test-summary")

	if !strings.Contains(result, "session: proj/my-session") {
		t.Error("template should contain session name in preamble")
	}

	if !strings.Contains(result, "AskUserQuestion") {
		t.Error("template should reference AskUserQuestion")
	}

	if !strings.Contains(result, "MUST use multiSelect: true. No exceptions") {
		t.Error("template should enforce multiSelect: true with no exceptions")
	}
}
