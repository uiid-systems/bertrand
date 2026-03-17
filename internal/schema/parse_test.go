package schema

import (
	"testing"
)

// Test parsing of real log lines in the exact format produced by bash hooks.
func TestParseHookOutput(t *testing.T) {
	tests := []struct {
		name      string
		line      string
		wantEvent string
		wantMeta  func(*TypedEvent) bool
	}{
		{
			name:      "session.block from on-blocked.sh",
			line:      `{"event":"session.block","session":"bertrand/testing-locally","ts":"2026-03-13T02:41:50Z","meta":{"question":"What next?","claude_id":"55d5ab5b-945b-4608-b190-8dbd1da92f95"}}`,
			wantEvent: "session.block",
			wantMeta: func(te *TypedEvent) bool {
				m, ok := te.TypedMeta.(*SessionBlockMeta)
				return ok && m.Question == "What next?" && m.ClaudeID == "55d5ab5b-945b-4608-b190-8dbd1da92f95"
			},
		},
		{
			name:      "session.resume from on-resumed.sh",
			line:      `{"event":"session.resume","session":"bertrand/testing-locally","ts":"2026-03-13T02:42:10Z","meta":{"claude_id":"55d5ab5b-945b-4608-b190-8dbd1da92f95"}}`,
			wantEvent: "session.resume",
			wantMeta: func(te *TypedEvent) bool {
				m, ok := te.TypedMeta.(*SessionUserResumeMeta)
				return ok && m.ClaudeID == "55d5ab5b-945b-4608-b190-8dbd1da92f95"
			},
		},
		{
			name:      "session.resume with answer",
			line:      `{"v":1,"event":"session.resume","session":"bertrand/testing","ts":"2026-03-16T01:00:00Z","meta":{"answer":"Fix duplicates, Group by conversation","claude_id":"abc-123"}}`,
			wantEvent: "session.resume",
			wantMeta: func(te *TypedEvent) bool {
				m, ok := te.TypedMeta.(*SessionUserResumeMeta)
				return ok && m.Answer == "Fix duplicates, Group by conversation" && m.ClaudeID == "abc-123"
			},
		},
		{
			name:      "permission.request from on-permission-wait.sh",
			line:      `{"event":"permission.request","session":"bertrand/testing","ts":"2026-03-13T02:45:00Z","meta":{"tool":"Bash","claude_id":"abc-123"}}`,
			wantEvent: "permission.request",
			wantMeta: func(te *TypedEvent) bool {
				m, ok := te.TypedMeta.(*PermissionMeta)
				return ok && m.Tool == "Bash" && m.ClaudeID == "abc-123"
			},
		},
		{
			name:      "permission.resolve from on-permission-done.sh",
			line:      `{"event":"permission.resolve","session":"bertrand/testing","ts":"2026-03-13T02:45:05Z","meta":{"tool":"Edit","claude_id":"abc-123"}}`,
			wantEvent: "permission.resolve",
			wantMeta: func(te *TypedEvent) bool {
				m, ok := te.TypedMeta.(*PermissionMeta)
				return ok && m.Tool == "Edit"
			},
		},
		{
			name:      "worktree.entered from on-worktree-entered.sh",
			line:      `{"event":"worktree.entered","session":"bertrand/testing","ts":"2026-03-13T02:46:00Z","meta":{"branch":"worktree-feat-x","claude_id":"abc-123"}}`,
			wantEvent: "worktree.entered",
			wantMeta: func(te *TypedEvent) bool {
				m, ok := te.TypedMeta.(*WorktreeEnteredMeta)
				return ok && m.Branch == "worktree-feat-x"
			},
		},
		{
			name:      "worktree.exited from on-worktree-exited.sh",
			line:      `{"event":"worktree.exited","session":"bertrand/testing","ts":"2026-03-13T02:47:00Z","meta":{"claude_id":"abc-123"}}`,
			wantEvent: "worktree.exited",
			wantMeta: func(te *TypedEvent) bool {
				m, ok := te.TypedMeta.(*ClaudeIDMeta)
				return ok && m.ClaudeID == "abc-123"
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			te, err := ParseEvent([]byte(tt.line))
			if err != nil {
				t.Fatal(err)
			}
			if te.Event != tt.wantEvent {
				t.Errorf("event = %q, want %q", te.Event, tt.wantEvent)
			}
			if !tt.wantMeta(te) {
				t.Errorf("meta check failed for %q, got %+v", tt.name, te.TypedMeta)
			}
		})
	}
}

// Test parsing of Go-side events (written by AppendEvent in session.go).
func TestParseGoSideEvents(t *testing.T) {
	tests := []struct {
		name      string
		line      string
		wantEvent string
	}{
		{
			name:      "session.started",
			line:      `{"event":"session.started","session":"bertrand/testing-locally","ts":"2026-03-13T02:41:48.848534Z","meta":{"pid":"72394"}}`,
			wantEvent: "session.started",
		},
		{
			name:      "claude.started",
			line:      `{"event":"claude.started","session":"bertrand/testing-locally","ts":"2026-03-13T02:41:48.849557Z","meta":{"claude_id":"55d5ab5b-945b-4608-b190-8dbd1da92f95"}}`,
			wantEvent: "claude.started",
		},
		{
			name:      "session.end",
			line:      `{"event":"session.end","session":"bertrand/testing-locally","ts":"2026-03-13T02:42:33.124789Z","meta":{"summary":"Session ended"}}`,
			wantEvent: "session.end",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			te, err := ParseEvent([]byte(tt.line))
			if err != nil {
				t.Fatal(err)
			}
			if te.Event != tt.wantEvent {
				t.Errorf("event = %q, want %q", te.Event, tt.wantEvent)
			}
		})
	}
}

// Test parsing of legacy State entries (written by WriteState).
func TestParseLegacyState(t *testing.T) {
	tests := []struct {
		name       string
		line       string
		wantEvent  string
		wantSummary string
	}{
		{
			name:       "working state",
			line:       `{"session":"bertrand/testing-locally","status":"working","summary":"Resumed after input","pid":72394,"timestamp":"2026-03-13T02:41:50Z"}`,
			wantEvent:  "state.working",
			wantSummary: "Resumed after input",
		},
		{
			name:       "blocked state",
			line:       `{"session":"bertrand/testing-locally","status":"blocked","summary":"What should we do?","pid":72394,"timestamp":"2026-03-13T02:42:00Z"}`,
			wantEvent:  "state.blocked",
			wantSummary: "What should we do?",
		},
		{
			name:       "done state",
			line:       `{"session":"bertrand/testing-locally","status":"done","summary":"Session ended","pid":75225,"timestamp":"2026-03-13T02:45:20.511145Z"}`,
			wantEvent:  "state.done",
			wantSummary: "Session ended",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			te, err := ParseEvent([]byte(tt.line))
			if err != nil {
				t.Fatal(err)
			}
			if te.Event != tt.wantEvent {
				t.Errorf("event = %q, want %q", te.Event, tt.wantEvent)
			}
			if te.V != 0 {
				t.Errorf("version = %d, want 0 for legacy", te.V)
			}
			m, ok := te.TypedMeta.(*LegacyStateMeta)
			if !ok {
				t.Fatalf("meta type = %T, want *LegacyStateMeta", te.TypedMeta)
			}
			if m.Summary != tt.wantSummary {
				t.Errorf("summary = %q, want %q", m.Summary, tt.wantSummary)
			}
		})
	}
}

// Test v1 events with version field.
func TestParseV1Event(t *testing.T) {
	line := `{"v":1,"event":"session.block","session":"proj/sess","ts":"2026-03-13T03:00:00Z","meta":{"question":"Pick one","claude_id":"uuid-1"}}`
	te, err := ParseEvent([]byte(line))
	if err != nil {
		t.Fatal(err)
	}
	if te.V != 1 {
		t.Errorf("version = %d, want 1", te.V)
	}
	if te.Event != "session.block" {
		t.Errorf("event = %q, want %q", te.Event, "session.block")
	}
}

// Test unknown event types are handled gracefully.
func TestParseUnknownEvent(t *testing.T) {
	line := `{"event":"future.event","session":"proj/sess","ts":"2026-03-13T03:00:00Z","meta":{"foo":"bar"}}`
	te, err := ParseEvent([]byte(line))
	if err != nil {
		t.Fatal(err)
	}
	if te.Event != "future.event" {
		t.Errorf("event = %q, want %q", te.Event, "future.event")
	}
	m, ok := te.TypedMeta.(map[string]string)
	if !ok {
		t.Fatalf("meta type = %T, want map[string]string for unknown events", te.TypedMeta)
	}
	if m["foo"] != "bar" {
		t.Errorf("meta[foo] = %q, want %q", m["foo"], "bar")
	}
}

// Test malformed input.
func TestParseMalformed(t *testing.T) {
	tests := []struct {
		name string
		line string
	}{
		{"empty", ""},
		{"not json", "hello world"},
		{"no event or status", `{"foo":"bar"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseEvent([]byte(tt.line))
			if err == nil {
				t.Error("expected error for malformed input")
			}
		})
	}
}

// Test MetaClaudeID extraction.
func TestMetaClaudeID(t *testing.T) {
	line := `{"event":"session.block","session":"p/s","ts":"2026-03-13T00:00:00Z","meta":{"question":"Q","claude_id":"test-uuid"}}`
	te, err := ParseEvent([]byte(line))
	if err != nil {
		t.Fatal(err)
	}
	if te.MetaClaudeID() != "test-uuid" {
		t.Errorf("MetaClaudeID() = %q, want %q", te.MetaClaudeID(), "test-uuid")
	}
}

// Test MetaSummary extraction.
func TestMetaSummary(t *testing.T) {
	tests := []struct {
		line        string
		wantSummary string
	}{
		{
			`{"event":"session.block","session":"p/s","ts":"2026-03-13T00:00:00Z","meta":{"question":"What next?","claude_id":"x"}}`,
			"What next?",
		},
		{
			`{"event":"session.end","session":"p/s","ts":"2026-03-13T00:00:00Z","meta":{"summary":"All done"}}`,
			"All done",
		},
		{
			`{"event":"permission.request","session":"p/s","ts":"2026-03-13T00:00:00Z","meta":{"tool":"Bash","claude_id":"x"}}`,
			"Bash",
		},
		{
			`{"event":"worktree.entered","session":"p/s","ts":"2026-03-13T00:00:00Z","meta":{"branch":"feat-x","claude_id":"x"}}`,
			"feat-x",
		},
		{
			`{"event":"context.snapshot","session":"p/s","ts":"2026-03-13T00:00:00Z","meta":{"model":"Opus","remaining_pct":"72","claude_id":"x"}}`,
			"Opus 72%",
		},
	}

	for _, tt := range tests {
		te, err := ParseEvent([]byte(tt.line))
		if err != nil {
			t.Fatal(err)
		}
		if got := te.MetaSummary(); got != tt.wantSummary {
			t.Errorf("MetaSummary() for %s = %q, want %q", te.Event, got, tt.wantSummary)
		}
	}
}

// Test that events with null or missing meta don't error.
func TestParseNullMeta(t *testing.T) {
	tests := []string{
		`{"event":"session.started","session":"p/s","ts":"2026-03-13T00:00:00Z"}`,
		`{"event":"session.started","session":"p/s","ts":"2026-03-13T00:00:00Z","meta":null}`,
	}
	for _, line := range tests {
		te, err := ParseEvent([]byte(line))
		if err != nil {
			t.Errorf("unexpected error for %q: %v", line, err)
		}
		if te.TypedMeta != nil {
			t.Errorf("expected nil meta for %q, got %+v", line, te.TypedMeta)
		}
	}
}
