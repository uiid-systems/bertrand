package log

import (
	"testing"
	"time"

	"github.com/uiid-systems/bertrand/internal/schema"
)

func TestExtractLinks_PRCreated(t *testing.T) {
	events := []*schema.TypedEvent{
		{Event: "gh.pr.created", TS: time.Now(), TypedMeta: &schema.GhPrCreatedMeta{
			PRNumber: "42", PRURL: "https://github.com/org/repo/pull/42", PRTitle: "Add auth flow",
		}},
	}
	links := ExtractLinks(events)
	if len(links) != 1 {
		t.Fatalf("expected 1 link, got %d", len(links))
	}
	if links[0].Kind != "pr" {
		t.Errorf("expected kind 'pr', got %q", links[0].Kind)
	}
	if links[0].URL != "https://github.com/org/repo/pull/42" {
		t.Errorf("unexpected URL: %q", links[0].URL)
	}
	if links[0].Label != "PR #42 Add auth flow" {
		t.Errorf("unexpected label: %q", links[0].Label)
	}
}

func TestExtractLinks_Dedup(t *testing.T) {
	events := []*schema.TypedEvent{
		{Event: "gh.pr.created", TS: time.Now(), TypedMeta: &schema.GhPrCreatedMeta{
			PRNumber: "42", PRURL: "https://github.com/org/repo/pull/42", PRTitle: "Add auth",
		}},
		{Event: "gh.pr.created", TS: time.Now(), TypedMeta: &schema.GhPrCreatedMeta{
			PRNumber: "42", PRURL: "https://github.com/org/repo/pull/42", PRTitle: "Add auth",
		}},
	}
	links := ExtractLinks(events)
	if len(links) != 1 {
		t.Fatalf("expected 1 link after dedup, got %d", len(links))
	}
}

func TestExtractLinks_PRMergedDedup(t *testing.T) {
	events := []*schema.TypedEvent{
		{Event: "gh.pr.created", TS: time.Now(), TypedMeta: &schema.GhPrCreatedMeta{
			PRNumber: "42", PRURL: "https://github.com/org/repo/pull/42",
		}},
		{Event: "gh.pr.merged", TS: time.Now(), TypedMeta: &schema.GhPrMergedMeta{
			PRNumber: "42",
		}},
	}
	links := ExtractLinks(events)
	// PR created has URL as key, merged has "pr:42" as key — both should appear
	// unless the created URL contains the same PR number
	if len(links) > 2 {
		t.Fatalf("expected at most 2 links, got %d", len(links))
	}
}

func TestExtractLinks_Linear(t *testing.T) {
	events := []*schema.TypedEvent{
		{Event: "linear.issue.read", TS: time.Now(), TypedMeta: &schema.LinearIssueReadMeta{
			IssueID: "ENG-123", IssueTitle: "Auth middleware",
		}},
	}
	links := ExtractLinks(events)
	if len(links) != 1 {
		t.Fatalf("expected 1 link, got %d", len(links))
	}
	if links[0].Kind != "linear" {
		t.Errorf("expected kind 'linear', got %q", links[0].Kind)
	}
	if links[0].Label != "ENG-123 Auth middleware" {
		t.Errorf("unexpected label: %q", links[0].Label)
	}
}

func TestExtractLinks_LinearEmpty(t *testing.T) {
	events := []*schema.TypedEvent{
		{Event: "linear.issue.read", TS: time.Now(), TypedMeta: &schema.LinearIssueReadMeta{}},
	}
	links := ExtractLinks(events)
	if len(links) != 0 {
		t.Fatalf("expected 0 links for empty issue ID, got %d", len(links))
	}
}

func TestExtractLinks_Notion(t *testing.T) {
	events := []*schema.TypedEvent{
		{Event: "notion.page.read", TS: time.Now(), TypedMeta: &schema.NotionPageReadMeta{
			PageID: "abc123", PageTitle: "Sprint Planning", PageURL: "https://notion.so/abc123",
		}},
	}
	links := ExtractLinks(events)
	if len(links) != 1 {
		t.Fatalf("expected 1 link, got %d", len(links))
	}
	if links[0].Kind != "notion" {
		t.Errorf("expected kind 'notion', got %q", links[0].Kind)
	}
	if links[0].URL != "https://notion.so/abc123" {
		t.Errorf("unexpected URL: %q", links[0].URL)
	}
}

func TestExtractLinks_Vercel(t *testing.T) {
	events := []*schema.TypedEvent{
		{Event: "vercel.deploy", TS: time.Now(), TypedMeta: &schema.VercelDeployMeta{
			DeployURL: "https://my-app.vercel.app", ProjectName: "my-app",
		}},
	}
	links := ExtractLinks(events)
	if len(links) != 1 {
		t.Fatalf("expected 1 link, got %d", len(links))
	}
	if links[0].Kind != "vercel" {
		t.Errorf("expected kind 'vercel', got %q", links[0].Kind)
	}
}

func TestExtractLinks_Branch(t *testing.T) {
	events := []*schema.TypedEvent{
		{Event: "worktree.entered", TS: time.Now(), TypedMeta: &schema.WorktreeEnteredMeta{
			Branch: "worktree-auth-middleware",
		}},
	}
	links := ExtractLinks(events)
	if len(links) != 1 {
		t.Fatalf("expected 1 link, got %d", len(links))
	}
	if links[0].Kind != "branch" {
		t.Errorf("expected kind 'branch', got %q", links[0].Kind)
	}
	if links[0].URL != "" {
		t.Errorf("branch should have no URL, got %q", links[0].URL)
	}
}

func TestExtractLinks_Mixed(t *testing.T) {
	events := []*schema.TypedEvent{
		{Event: "session.started", TS: time.Now(), TypedMeta: &schema.SessionStartedMeta{PID: "123"}},
		{Event: "worktree.entered", TS: time.Now(), TypedMeta: &schema.WorktreeEnteredMeta{Branch: "feat-branch"}},
		{Event: "linear.issue.read", TS: time.Now(), TypedMeta: &schema.LinearIssueReadMeta{IssueID: "ENG-1"}},
		{Event: "gh.pr.created", TS: time.Now(), TypedMeta: &schema.GhPrCreatedMeta{PRNumber: "10", PRURL: "https://github.com/o/r/pull/10"}},
		{Event: "session.end", TS: time.Now(), TypedMeta: &schema.SessionEndMeta{Summary: "done"}},
	}
	links := ExtractLinks(events)
	if len(links) != 3 {
		t.Fatalf("expected 3 links (branch, linear, pr), got %d", len(links))
	}
	// Order should match event order
	if links[0].Kind != "branch" {
		t.Errorf("first link should be branch, got %q", links[0].Kind)
	}
	if links[1].Kind != "linear" {
		t.Errorf("second link should be linear, got %q", links[1].Kind)
	}
	if links[2].Kind != "pr" {
		t.Errorf("third link should be pr, got %q", links[2].Kind)
	}
}

func TestExtractLinks_Empty(t *testing.T) {
	links := ExtractLinks(nil)
	if len(links) != 0 {
		t.Fatalf("expected 0 links for nil events, got %d", len(links))
	}
}
