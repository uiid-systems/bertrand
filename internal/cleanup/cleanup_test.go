package cleanup

import (
	"testing"
)

func TestParseWorktreeList(t *testing.T) {
	input := `worktree /Users/adam/repo
HEAD abc123
branch refs/heads/main

worktree /Users/adam/repo/.claude/worktrees/fix-auth
HEAD def456
branch refs/heads/worktree-fix-auth

worktree /Users/adam/repo/.claude/worktrees/add-tests
HEAD 789abc
branch refs/heads/worktree-add-tests

`
	worktrees := parseWorktreeList(input)
	if len(worktrees) != 3 {
		t.Fatalf("expected 3 worktrees, got %d", len(worktrees))
	}

	if worktrees[0].Path != "/Users/adam/repo" {
		t.Errorf("expected main worktree path, got %s", worktrees[0].Path)
	}
	if worktrees[0].Branch != "main" {
		t.Errorf("expected branch main, got %s", worktrees[0].Branch)
	}

	if worktrees[1].Branch != "worktree-fix-auth" {
		t.Errorf("expected branch worktree-fix-auth, got %s", worktrees[1].Branch)
	}

	if worktrees[2].Branch != "worktree-add-tests" {
		t.Errorf("expected branch worktree-add-tests, got %s", worktrees[2].Branch)
	}
}

func TestPlanEmpty(t *testing.T) {
	p := Plan{}
	if !p.Empty() {
		t.Error("expected empty plan")
	}

	p.Branches = []Item{{Kind: "branch", Name: "test"}}
	if p.Empty() {
		t.Error("expected non-empty plan")
	}
}

func TestPlanTotal(t *testing.T) {
	p := Plan{
		Worktrees: []Item{{}, {}},
		Branches:  []Item{{}},
		Sessions:  []Item{{}, {}, {}},
	}
	if p.Total() != 6 {
		t.Errorf("expected total 6, got %d", p.Total())
	}
}
