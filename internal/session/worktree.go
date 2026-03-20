package session

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// WorktreeInfo holds parsed output from git worktree list --porcelain.
type WorktreeInfo struct {
	Path   string
	Branch string
}

// ListWorktrees runs git worktree list --porcelain in the given repo directory
// and returns the parsed results.
func ListWorktrees(repoDir string) ([]WorktreeInfo, error) {
	cmd := exec.Command("git", "-C", repoDir, "worktree", "list", "--porcelain")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("listing worktrees: %w", err)
	}
	return ParseWorktreeList(string(out)), nil
}

// ParseWorktreeList parses the porcelain output of git worktree list.
func ParseWorktreeList(output string) []WorktreeInfo {
	var worktrees []WorktreeInfo
	var current WorktreeInfo

	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if current.Path != "" {
				worktrees = append(worktrees, current)
			}
			current = WorktreeInfo{}
			continue
		}
		if strings.HasPrefix(line, "worktree ") {
			current.Path = strings.TrimPrefix(line, "worktree ")
		}
		if strings.HasPrefix(line, "branch ") {
			ref := strings.TrimPrefix(line, "branch ")
			current.Branch = strings.TrimPrefix(ref, "refs/heads/")
		}
	}
	if current.Path != "" {
		worktrees = append(worktrees, current)
	}

	return worktrees
}

// ResolveWorktreePath finds the filesystem path for a worktree by its branch name.
func ResolveWorktreePath(repoDir, branch string) (string, error) {
	worktrees, err := ListWorktrees(repoDir)
	if err != nil {
		return "", err
	}

	for _, wt := range worktrees {
		if wt.Branch == branch {
			if _, err := os.Stat(wt.Path); err != nil {
				return "", fmt.Errorf("worktree path %s does not exist", wt.Path)
			}
			return wt.Path, nil
		}
	}

	return "", fmt.Errorf("worktree for branch %q not found (may have been removed)", branch)
}
