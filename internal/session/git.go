package session

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// FileDiff holds per-file diff stats from git diff --numstat.
type FileDiff struct {
	Path      string `json:"path"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

// FindRepoRoot returns the git repository root for the current working directory.
func FindRepoRoot() string {
	cmd := exec.Command("git", "rev-parse", "--show-toplevel")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// DetectMainBranch returns the main/master branch name for a repo.
func DetectMainBranch(repoDir string) string {
	cmd := exec.Command("git", "-C", repoDir, "symbolic-ref", "refs/remotes/origin/HEAD")
	out, err := cmd.Output()
	if err == nil {
		ref := strings.TrimSpace(string(out))
		return strings.TrimPrefix(ref, "refs/remotes/origin/")
	}
	// Fallback: check if main exists
	cmd = exec.Command("git", "-C", repoDir, "rev-parse", "--verify", "main")
	if err := cmd.Run(); err == nil {
		return "main"
	}
	return "master"
}

// FindWorktreePathByBranch searches for a worktree with the given branch name
// across all repos that have .claude/worktrees/ directories under the user's
// home directory. This handles the common case where sessions span multiple repos.
func FindWorktreePathByBranch(branch string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	// Scan common project locations for repos with .claude/worktrees/
	searchDirs := []string{
		filepath.Join(home, "www"),
		filepath.Join(home, "projects"),
		filepath.Join(home, "src"),
		filepath.Join(home, "code"),
		filepath.Join(home, "dev"),
	}

	for _, searchDir := range searchDirs {
		result := findWorktreeInDir(searchDir, branch, 4)
		if result != "" {
			return result
		}
	}
	return ""
}

func findWorktreeInDir(dir, branch string, depth int) string {
	if depth <= 0 {
		return ""
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if !e.IsDir() || e.Name()[0] == '.' || e.Name() == "node_modules" {
			continue
		}
		full := filepath.Join(dir, e.Name())
		// Check if this directory is a git repo with worktrees
		gitDir := filepath.Join(full, ".git")
		if _, err := os.Stat(gitDir); err == nil {
			// It's a git repo — check for the branch in its worktrees
			path, err := ResolveWorktreePath(full, branch)
			if err == nil {
				return path
			}
		}
		// Recurse into subdirectories
		result := findWorktreeInDir(full, branch, depth-1)
		if result != "" {
			return result
		}
	}
	return ""
}

// DiffNumstat runs git diff --numstat against the base branch from a worktree path
// and returns per-file diff stats.
func DiffNumstat(wtPath, baseBranch string) ([]FileDiff, error) {
	// Try merge-base diff first (shows only changes since branching)
	cmd := exec.Command("git", "-C", wtPath, "diff", "--numstat", baseBranch+"...HEAD")
	out, err := cmd.Output()
	if err != nil || len(strings.TrimSpace(string(out))) == 0 {
		// Fall back to direct diff against the base branch
		cmd = exec.Command("git", "-C", wtPath, "diff", "--numstat", baseBranch)
		out, err = cmd.Output()
		if err != nil {
			return nil, err
		}
	}

	var files []FileDiff
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) != 3 {
			continue
		}
		// Binary files show "-" for additions/deletions
		add, _ := strconv.Atoi(parts[0])
		del, _ := strconv.Atoi(parts[1])
		files = append(files, FileDiff{
			Path:      parts[2],
			Additions: add,
			Deletions: del,
		})
	}
	return files, nil
}
