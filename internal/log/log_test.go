package log

import (
	"testing"
	"time"
)

func TestLookup_Known(t *testing.T) {
	info := Lookup("session.started")
	if info.Label != "started" {
		t.Errorf("expected label 'started', got %q", info.Label)
	}
	if info.ColorANSI != 78 {
		t.Errorf("expected ColorANSI 78, got %d", info.ColorANSI)
	}
}

func TestLookup_Unknown(t *testing.T) {
	info := Lookup("unknown.event")
	if info.Label != "unknown.event" {
		t.Errorf("expected label to echo event name, got %q", info.Label)
	}
	if info.ColorANSI != 241 {
		t.Errorf("expected default ColorANSI 241, got %d", info.ColorANSI)
	}
}

func TestLookup_Skip(t *testing.T) {
	info := Lookup("context.snapshot")
	if !info.Skip {
		t.Error("context.snapshot should have Skip=true")
	}
}

func TestEnrichAll(t *testing.T) {
	// EnrichAll with nil input should return empty, not panic
	result := EnrichAll(nil)
	if len(result) != 0 {
		t.Errorf("expected empty result, got %d", len(result))
	}
}

func TestCompact_PermissionCollapse(t *testing.T) {
	now := time.Now()
	entries := []EnrichedEvent{
		{Event: "session.started", TS: now, Label: "started"},
		{Event: "permission.request", TS: now.Add(1 * time.Second), Summary: "Bash"},
		{Event: "permission.resolve", TS: now.Add(2 * time.Second), Summary: "Bash"},
		{Event: "permission.request", TS: now.Add(3 * time.Second), Summary: "Bash"},
		{Event: "permission.resolve", TS: now.Add(4 * time.Second), Summary: "Bash"},
		{Event: "permission.request", TS: now.Add(5 * time.Second), Summary: "Edit"},
		{Event: "permission.resolve", TS: now.Add(6 * time.Second), Summary: "Edit"},
		{Event: "session.block", TS: now.Add(7 * time.Second), Summary: "What next?", Label: "blocked"},
	}

	result := Compact(entries)

	if len(result) != 3 {
		t.Fatalf("expected 3 entries, got %d: %+v", len(result), result)
	}

	if result[0].Event != "session.started" {
		t.Errorf("expected session.started, got %s", result[0].Event)
	}
	if result[1].Event != "tool.work" {
		t.Errorf("expected tool.work, got %s", result[1].Event)
	}
	// 2x Bash should come before Edit (higher count first)
	if result[1].Summary != "2\u00d7 Bash, Edit" {
		t.Errorf("expected '2\u00d7 Bash, Edit', got %q", result[1].Summary)
	}
	if result[2].Event != "session.block" {
		t.Errorf("expected session.block, got %s", result[2].Event)
	}
}

func TestCompact_ConsecutiveDedup(t *testing.T) {
	now := time.Now()
	entries := []EnrichedEvent{
		{Event: "session.started", TS: now, Label: "started"},
		{Event: "session.block", TS: now.Add(1 * time.Second), Summary: "First question", Label: "blocked"},
		{Event: "session.block", TS: now.Add(2 * time.Second), Summary: "Second question", Label: "blocked"},
		{Event: "session.end", TS: now.Add(3 * time.Second), Label: "ended"},
	}

	result := Compact(entries)

	if len(result) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(result))
	}
	// Should keep the later block event
	if result[1].Summary != "Second question" {
		t.Errorf("expected 'Second question', got %q", result[1].Summary)
	}
}

func TestCompact_DropContextSnapshot(t *testing.T) {
	now := time.Now()
	entries := []EnrichedEvent{
		{Event: "session.started", TS: now, Label: "started"},
		{Event: "context.snapshot", TS: now.Add(1 * time.Second), Summary: "opus 85%"},
		{Event: "session.block", TS: now.Add(2 * time.Second), Summary: "Question", Label: "blocked"},
		{Event: "context.snapshot", TS: now.Add(3 * time.Second), Summary: "opus 70%"},
		{Event: "session.end", TS: now.Add(4 * time.Second), Label: "ended"},
	}

	result := Compact(entries)

	if len(result) != 3 {
		t.Fatalf("expected 3 entries (no snapshots), got %d", len(result))
	}
	for _, e := range result {
		if e.Event == "context.snapshot" {
			t.Error("context.snapshot should be dropped")
		}
	}
}

func TestCompact_Empty(t *testing.T) {
	result := Compact(nil)
	if len(result) != 0 {
		t.Errorf("expected empty result, got %d entries", len(result))
	}
}

func TestCompact_SinglePermission(t *testing.T) {
	now := time.Now()
	entries := []EnrichedEvent{
		{Event: "session.started", TS: now, Label: "started"},
		{Event: "permission.request", TS: now.Add(1 * time.Second), Summary: "Bash"},
		{Event: "permission.resolve", TS: now.Add(2 * time.Second), Summary: "Bash"},
		{Event: "session.end", TS: now.Add(3 * time.Second), Label: "ended"},
	}

	result := Compact(entries)

	if len(result) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(result))
	}
	if result[1].Event != "tool.work" {
		t.Errorf("expected tool.work, got %s", result[1].Event)
	}
	if result[1].Summary != "Bash" {
		t.Errorf("expected 'Bash', got %q", result[1].Summary)
	}
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		d    time.Duration
		want string
	}{
		{30 * time.Second, "30s"},
		{5 * time.Minute, "5m"},
		{2 * time.Hour, "2h"},
		{90 * time.Minute, "1h30m"},
	}
	for _, tt := range tests {
		got := FormatDuration(tt.d)
		if got != tt.want {
			t.Errorf("FormatDuration(%v) = %q, want %q", tt.d, got, tt.want)
		}
	}
}

func TestFormatAgo(t *testing.T) {
	now := time.Now()
	got := FormatAgo(now)
	if got != "just now" {
		t.Errorf("FormatAgo(now) = %q, want 'just now'", got)
	}

	got = FormatAgo(now.Add(-2 * time.Hour))
	if got != "2h" {
		t.Errorf("FormatAgo(-2h) = %q, want '2h'", got)
	}
}
