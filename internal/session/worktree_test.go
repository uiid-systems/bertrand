package session

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
	worktrees := ParseWorktreeList(input)
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

func TestParseWorktreeListEmpty(t *testing.T) {
	worktrees := ParseWorktreeList("")
	if len(worktrees) != 0 {
		t.Errorf("expected 0 worktrees, got %d", len(worktrees))
	}
}

func TestParseWorktreeListDetachedHead(t *testing.T) {
	input := `worktree /Users/adam/repo
HEAD abc123
branch refs/heads/main

worktree /Users/adam/repo/.claude/worktrees/detached
HEAD def456
detached

`
	worktrees := ParseWorktreeList(input)
	if len(worktrees) != 2 {
		t.Fatalf("expected 2 worktrees, got %d", len(worktrees))
	}

	if worktrees[1].Branch != "" {
		t.Errorf("expected empty branch for detached HEAD, got %s", worktrees[1].Branch)
	}
	if worktrees[1].Path != "/Users/adam/repo/.claude/worktrees/detached" {
		t.Errorf("expected detached worktree path, got %s", worktrees[1].Path)
	}
}

func TestParseWorktreeListNoTrailingNewline(t *testing.T) {
	input := `worktree /Users/adam/repo
HEAD abc123
branch refs/heads/main`

	worktrees := ParseWorktreeList(input)
	if len(worktrees) != 1 {
		t.Fatalf("expected 1 worktree, got %d", len(worktrees))
	}
	if worktrees[0].Branch != "main" {
		t.Errorf("expected branch main, got %s", worktrees[0].Branch)
	}
}
