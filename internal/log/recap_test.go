package log

import (
	"strings"
	"testing"
	"time"
)

func TestRenderRecap_FullRecap(t *testing.T) {
	summary := "Implemented auth middleware and created PR"
	links := []SessionLink{
		{Kind: "pr", Label: "PR #42 Add auth flow", URL: "https://github.com/org/repo/pull/42"},
		{Kind: "linear", Label: "ENG-123 Auth middleware"},
		{Kind: "branch", Label: "worktree-auth-middleware"},
	}
	stats := RecapStats{Events: 12, Conversations: 2, Duration: 47 * time.Minute}

	result := RenderRecap(summary, links, stats, "proj/auth")

	if !strings.Contains(result, "Implemented auth middleware") {
		t.Error("recap should contain summary text")
	}
	if !strings.Contains(result, "PR #42 Add auth flow") {
		t.Error("recap should contain PR link label")
	}
	if !strings.Contains(result, "https://github.com/org/repo/pull/42") {
		t.Error("recap should contain PR URL")
	}
	if !strings.Contains(result, "ENG-123") {
		t.Error("recap should contain Linear issue")
	}
	if !strings.Contains(result, "worktree-auth-middleware") {
		t.Error("recap should contain branch name")
	}
	if !strings.Contains(result, "12") {
		t.Error("recap should contain event count")
	}
	if !strings.Contains(result, "2") {
		t.Error("recap should contain conversation count")
	}
	if !strings.Contains(result, "bertrand log proj/auth") {
		t.Error("recap should contain log hint")
	}
}

func TestRenderRecap_NoSummary(t *testing.T) {
	links := []SessionLink{
		{Kind: "pr", Label: "PR #1", URL: "https://example.com/1"},
	}
	stats := RecapStats{Events: 5, Conversations: 1, Duration: 10 * time.Minute}

	result := RenderRecap("", links, stats, "proj/test")

	// Should not have the summary line but should have links and stats
	if strings.Contains(result, "What happened") {
		t.Error("recap without summary should not show 'What happened' line")
	}
	if !strings.Contains(result, "PR #1") {
		t.Error("recap should still contain links")
	}
}

func TestRenderRecap_GenericSummarySkipped(t *testing.T) {
	stats := RecapStats{Events: 3, Conversations: 1, Duration: 5 * time.Minute}

	result := RenderRecap("Session ended", nil, stats, "proj/test")

	// "Session ended" is generic and should be skipped
	if strings.Contains(result, "Session ended") {
		t.Error("generic summary 'Session ended' should be omitted")
	}
}

func TestRenderRecap_NoLinks(t *testing.T) {
	stats := RecapStats{Events: 8, Conversations: 1, Duration: 20 * time.Minute}

	result := RenderRecap("Fixed a bug", nil, stats, "proj/bugfix")

	if !strings.Contains(result, "Fixed a bug") {
		t.Error("recap should contain summary")
	}
	if !strings.Contains(result, "8") {
		t.Error("recap should contain event count")
	}
}

func TestRenderRecap_SingleConversation(t *testing.T) {
	stats := RecapStats{Events: 5, Conversations: 1, Duration: 10 * time.Minute}

	result := RenderRecap("", nil, stats, "proj/test")

	// Single conversation should NOT show "1 conversations"
	if strings.Contains(result, "conversations") {
		t.Error("single conversation should not show conversation count")
	}
}

func TestRenderRecap_MultipleConversations(t *testing.T) {
	stats := RecapStats{Events: 20, Conversations: 3, Duration: 60 * time.Minute}

	result := RenderRecap("", nil, stats, "proj/test")

	if !strings.Contains(result, "3") {
		t.Error("multiple conversations should show count")
	}
	if !strings.Contains(result, "conversations") {
		t.Error("multiple conversations should show 'conversations' label")
	}
}

func TestRecapStatsFrom(t *testing.T) {
	now := time.Now()
	d := &SessionDigest{
		StartedAt:     now,
		EndedAt:       now.Add(30 * time.Minute),
		EventCount:    15,
		Conversations: 2,
	}

	stats := RecapStatsFrom(d)

	if stats.Events != 15 {
		t.Errorf("expected 15 events, got %d", stats.Events)
	}
	if stats.Conversations != 2 {
		t.Errorf("expected 2 conversations, got %d", stats.Conversations)
	}
	if stats.Duration != 30*time.Minute {
		t.Errorf("expected 30m duration, got %v", stats.Duration)
	}
}
