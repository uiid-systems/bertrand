package schema

import (
	"testing"
	"time"
)

func te(event string, offset time.Duration) *TypedEvent {
	return &TypedEvent{
		Event: event,
		TS:    time.Date(2026, 3, 13, 0, 0, 0, 0, time.UTC).Add(offset),
		TypedMeta: &ClaudeIDMeta{ClaudeID: "test-uuid"},
	}
}

func TestComputeTimings_BasicFlow(t *testing.T) {
	events := []*TypedEvent{
		te("claude.started", 0),
		te("session.block", 10*time.Second),    // claude worked 10s
		te("session.resume", 30*time.Second),   // user waited 20s
		te("session.block", 45*time.Second),    // claude worked 15s
		te("session.resume", 50*time.Second),   // user waited 5s
		te("claude.ended", 60*time.Second),     // claude worked 10s
	}

	s := ComputeTimings(events)

	if len(s.Segments) != 5 {
		t.Fatalf("segments = %d, want 5", len(s.Segments))
	}

	// Check types in order
	wantTypes := []TimingType{TimingClaudeWork, TimingUserWait, TimingClaudeWork, TimingUserWait, TimingClaudeWork}
	for i, seg := range s.Segments {
		if seg.Type != wantTypes[i] {
			t.Errorf("segment[%d].Type = %q, want %q", i, seg.Type, wantTypes[i])
		}
	}

	// Total claude work: 10 + 15 + 10 = 35s
	if s.TotalClaudeWork != 35*time.Second {
		t.Errorf("TotalClaudeWork = %s, want 35s", s.TotalClaudeWork)
	}

	// Total user wait: 20 + 5 = 25s
	if s.TotalUserWait != 25*time.Second {
		t.Errorf("TotalUserWait = %s, want 25s", s.TotalUserWait)
	}
}

func TestComputeTimings_Empty(t *testing.T) {
	s := ComputeTimings(nil)
	if len(s.Segments) != 0 {
		t.Errorf("segments = %d, want 0", len(s.Segments))
	}
	if s.TotalClaudeWork != 0 || s.TotalUserWait != 0 {
		t.Error("expected zero totals for empty input")
	}
}

func TestComputeTimings_NoBlocks(t *testing.T) {
	events := []*TypedEvent{
		te("claude.started", 0),
		te("claude.ended", 30*time.Second),
	}

	s := ComputeTimings(events)

	if len(s.Segments) != 1 {
		t.Fatalf("segments = %d, want 1", len(s.Segments))
	}
	if s.Segments[0].Type != TimingClaudeWork {
		t.Errorf("type = %q, want %q", s.Segments[0].Type, TimingClaudeWork)
	}
	if s.TotalClaudeWork != 30*time.Second {
		t.Errorf("TotalClaudeWork = %s, want 30s", s.TotalClaudeWork)
	}
}

func TestComputeTimings_BlockedAtEnd(t *testing.T) {
	// Claude ended while user was still "blocked" (session.block with no resume before claude.ended)
	events := []*TypedEvent{
		te("claude.started", 0),
		te("session.block", 10*time.Second),
		te("claude.ended", 25*time.Second),
	}

	s := ComputeTimings(events)

	// Should have: claude work (0-10s), user wait (10-25s)
	if len(s.Segments) != 2 {
		t.Fatalf("segments = %d, want 2", len(s.Segments))
	}
	if s.TotalClaudeWork != 10*time.Second {
		t.Errorf("TotalClaudeWork = %s, want 10s", s.TotalClaudeWork)
	}
	if s.TotalUserWait != 15*time.Second {
		t.Errorf("TotalUserWait = %s, want 15s", s.TotalUserWait)
	}
}

func TestComputeTimings_IgnoresOtherEvents(t *testing.T) {
	events := []*TypedEvent{
		te("claude.started", 0),
		te("permission.request", 5*time.Second),
		te("permission.resolve", 8*time.Second),
		te("session.block", 15*time.Second),
		te("session.resume", 20*time.Second),
		te("claude.ended", 30*time.Second),
	}

	s := ComputeTimings(events)

	// Only timing-relevant events matter: claude.started→session.block, session.block→session.resume, session.resume→claude.ended
	if s.TotalClaudeWork != 25*time.Second { // 15s + 10s
		t.Errorf("TotalClaudeWork = %s, want 25s", s.TotalClaudeWork)
	}
	if s.TotalUserWait != 5*time.Second {
		t.Errorf("TotalUserWait = %s, want 5s", s.TotalUserWait)
	}
}
