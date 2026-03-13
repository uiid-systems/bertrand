package schema

import (
	"encoding/json"
	"testing"
	"time"
)

func TestNewEvent(t *testing.T) {
	meta := &SessionBlockMeta{Question: "What next?", ClaudeID: "abc-123"}
	ev, err := NewEvent("session.block", "proj/sess", meta)
	if err != nil {
		t.Fatal(err)
	}
	if ev.V != Version {
		t.Errorf("version = %d, want %d", ev.V, Version)
	}
	if ev.Event != "session.block" {
		t.Errorf("event = %q, want %q", ev.Event, "session.block")
	}
	if ev.Session != "proj/sess" {
		t.Errorf("session = %q, want %q", ev.Session, "proj/sess")
	}
	if ev.TS.IsZero() {
		t.Error("timestamp should not be zero")
	}

	// Round-trip: marshal and parse back
	line, err := json.Marshal(ev)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseEvent(line)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Event != "session.block" {
		t.Errorf("parsed event = %q, want %q", parsed.Event, "session.block")
	}
	m, ok := parsed.TypedMeta.(*SessionBlockMeta)
	if !ok {
		t.Fatalf("meta type = %T, want *SessionBlockMeta", parsed.TypedMeta)
	}
	if m.Question != "What next?" {
		t.Errorf("question = %q, want %q", m.Question, "What next?")
	}
	if m.ClaudeID != "abc-123" {
		t.Errorf("claude_id = %q, want %q", m.ClaudeID, "abc-123")
	}
}

func TestEventMarshalJSON(t *testing.T) {
	ev := &Event{
		V:       1,
		Event:   "session.started",
		Session: "bertrand/testing",
		TS:      time.Date(2026, 3, 13, 2, 41, 48, 0, time.UTC),
		Meta:    json.RawMessage(`{"pid":"72394"}`),
	}

	line, err := json.Marshal(ev)
	if err != nil {
		t.Fatal(err)
	}

	// Verify it round-trips
	var ev2 Event
	if err := json.Unmarshal(line, &ev2); err != nil {
		t.Fatal(err)
	}
	if ev2.V != 1 {
		t.Errorf("v = %d, want 1", ev2.V)
	}
	if ev2.Event != "session.started" {
		t.Errorf("event = %q, want %q", ev2.Event, "session.started")
	}
}

func TestAllMetaTypes(t *testing.T) {
	tests := []struct {
		event string
		meta  any
	}{
		{"session.started", &SessionStartedMeta{PID: "1234"}},
		{"session.resumed", &SessionResumedMeta{PID: "5678"}},
		{"session.end", &SessionEndMeta{Summary: "Done"}},
		{"claude.started", &ClaudeIDMeta{ClaudeID: "uuid-1"}},
		{"claude.ended", &ClaudeIDMeta{ClaudeID: "uuid-2"}},
		{"session.block", &SessionBlockMeta{Question: "Q?", ClaudeID: "uuid-3"}},
		{"session.resume", &ClaudeIDMeta{ClaudeID: "uuid-4"}},
		{"permission.request", &PermissionMeta{Tool: "Bash", ClaudeID: "uuid-5"}},
		{"permission.resolve", &PermissionMeta{Tool: "Edit", ClaudeID: "uuid-6"}},
		{"worktree.entered", &WorktreeEnteredMeta{Branch: "feat-x", ClaudeID: "uuid-7"}},
		{"worktree.exited", &ClaudeIDMeta{ClaudeID: "uuid-8"}},
		{"gh.pr.created", &GhPrCreatedMeta{PRNumber: "42", PRURL: "https://github.com/org/repo/pull/42", Branch: "feat-x", ClaudeID: "uuid-9"}},
		{"gh.pr.merged", &GhPrMergedMeta{PRNumber: "42", Branch: "feat-x", ClaudeID: "uuid-10"}},
		{"linear.issue.read", &LinearIssueReadMeta{IssueID: "ELKY-7", IssueTitle: "Schema", ToolName: "get_issue", ClaudeID: "uuid-11"}},
		{"context.snapshot", &ContextSnapshotMeta{Model: "Claude Opus 4.6", InputTokens: "50000", CacheCreationTokens: "1000", CacheReadTokens: "4000", ContextWindowSize: "200000", RemainingPct: "72", ClaudeID: "uuid-12"}},
	}

	for _, tt := range tests {
		t.Run(tt.event, func(t *testing.T) {
			ev, err := NewEvent(tt.event, "test/sess", tt.meta)
			if err != nil {
				t.Fatal(err)
			}
			line, err := json.Marshal(ev)
			if err != nil {
				t.Fatal(err)
			}
			parsed, err := ParseEvent(line)
			if err != nil {
				t.Fatal(err)
			}
			if parsed.Event != tt.event {
				t.Errorf("event = %q, want %q", parsed.Event, tt.event)
			}
			if parsed.V != Version {
				t.Errorf("version = %d, want %d", parsed.V, Version)
			}
		})
	}
}
