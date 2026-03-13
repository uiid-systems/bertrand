package cmd

import (
	"testing"
	"time"
)

func TestCompactTimeline_PermissionCollapse(t *testing.T) {
	now := time.Now()
	entries := []unifiedEntry{
		{Event: "session.started", TS: now, Summary: ""},
		{Event: "permission.request", TS: now.Add(1 * time.Second), Summary: "Bash"},
		{Event: "permission.resolve", TS: now.Add(2 * time.Second), Summary: "Bash"},
		{Event: "permission.request", TS: now.Add(3 * time.Second), Summary: "Bash"},
		{Event: "permission.resolve", TS: now.Add(4 * time.Second), Summary: "Bash"},
		{Event: "permission.request", TS: now.Add(5 * time.Second), Summary: "Edit"},
		{Event: "permission.resolve", TS: now.Add(6 * time.Second), Summary: "Edit"},
		{Event: "session.block", TS: now.Add(7 * time.Second), Summary: "What next?"},
	}

	result := compactTimeline(entries)

	if len(result) != 3 {
		t.Fatalf("expected 3 entries, got %d: %+v", len(result), result)
	}

	if result[0].Event != "session.started" {
		t.Errorf("expected session.started, got %s", result[0].Event)
	}
	if result[1].Event != "tool.work" {
		t.Errorf("expected tool.work, got %s", result[1].Event)
	}
	// 2× Bash should come before Edit (higher count first)
	if result[1].Summary != "2× Bash, Edit" {
		t.Errorf("expected '2× Bash, Edit', got %q", result[1].Summary)
	}
	if result[2].Event != "session.block" {
		t.Errorf("expected session.block, got %s", result[2].Event)
	}
}

func TestCompactTimeline_ConsecutiveDedup(t *testing.T) {
	now := time.Now()
	entries := []unifiedEntry{
		{Event: "session.started", TS: now},
		{Event: "session.block", TS: now.Add(1 * time.Second), Summary: "First question"},
		{Event: "session.block", TS: now.Add(2 * time.Second), Summary: "Second question"},
		{Event: "session.end", TS: now.Add(3 * time.Second)},
	}

	result := compactTimeline(entries)

	if len(result) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(result))
	}
	// Should keep the later block event
	if result[1].Summary != "Second question" {
		t.Errorf("expected 'Second question', got %q", result[1].Summary)
	}
}

func TestCompactTimeline_DropContextSnapshot(t *testing.T) {
	now := time.Now()
	entries := []unifiedEntry{
		{Event: "session.started", TS: now},
		{Event: "context.snapshot", TS: now.Add(1 * time.Second), Summary: "opus 85%"},
		{Event: "session.block", TS: now.Add(2 * time.Second), Summary: "Question"},
		{Event: "context.snapshot", TS: now.Add(3 * time.Second), Summary: "opus 70%"},
		{Event: "session.end", TS: now.Add(4 * time.Second)},
	}

	result := compactTimeline(entries)

	if len(result) != 3 {
		t.Fatalf("expected 3 entries (no snapshots), got %d", len(result))
	}
	for _, e := range result {
		if e.Event == "context.snapshot" {
			t.Error("context.snapshot should be dropped")
		}
	}
}

func TestCompactTimeline_Empty(t *testing.T) {
	result := compactTimeline(nil)
	if len(result) != 0 {
		t.Errorf("expected empty result, got %d entries", len(result))
	}
}

func TestCompactTimeline_SinglePermission(t *testing.T) {
	now := time.Now()
	entries := []unifiedEntry{
		{Event: "session.started", TS: now},
		{Event: "permission.request", TS: now.Add(1 * time.Second), Summary: "Bash"},
		{Event: "permission.resolve", TS: now.Add(2 * time.Second), Summary: "Bash"},
		{Event: "session.end", TS: now.Add(3 * time.Second)},
	}

	result := compactTimeline(entries)

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
