package cleanup

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/uiid-systems/bertrand/internal/session"
)

// Item represents a single thing that can be cleaned up.
type Item struct {
	Kind        string // "worktree", "branch", "session"
	Name        string // display name
	Detail      string // extra info (e.g. branch name, PR number)
	Age         time.Duration
	SessionName string // associated session, if any
}

// Plan holds all items to clean up, grouped by kind.
type Plan struct {
	Worktrees []Item
	Branches  []Item
	Sessions  []Item
}

// Empty returns true if there's nothing to clean up.
func (p Plan) Empty() bool {
	return len(p.Worktrees) == 0 && len(p.Branches) == 0 && len(p.Sessions) == 0
}

// Total returns the total number of items.
func (p Plan) Total() int {
	return len(p.Worktrees) + len(p.Branches) + len(p.Sessions)
}

// Scan builds a cleanup plan by inspecting worktrees, branches, and sessions.
func Scan(repoDir string) (*Plan, error) {
	plan := &Plan{}

	worktrees, err := scanWorktrees(repoDir)
	if err == nil {
		plan.Worktrees = worktrees
	}

	branches, err := scanMergedBranches(repoDir)
	if err == nil {
		plan.Branches = branches
	}

	sessions, err := scanDoneSessions()
	if err == nil {
		plan.Sessions = sessions
	}

	return plan, nil
}

// worktreeInfo holds parsed output from git worktree list --porcelain.
type worktreeInfo struct {
	Path   string
	Branch string
}

func scanWorktrees(repoDir string) ([]Item, error) {
	cmd := exec.Command("git", "-C", repoDir, "worktree", "list", "--porcelain")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	worktrees := parseWorktreeList(string(out))

	// Get all sessions and their worktree markers
	allSessions, err := session.ListSessions()
	if err != nil {
		allSessions = nil
	}

	// Build map: branch name → session state
	branchToSession := make(map[string]session.State)
	for _, s := range allSessions {
		wt := session.ReadWorktree(s.Session)
		if wt != "" {
			branchToSession[wt] = s
		}
	}

	var items []Item
	for _, wt := range worktrees {
		// Skip the main worktree (no branch or it's the repo root)
		if wt.Path == repoDir || wt.Branch == "" {
			continue
		}

		// Check if a session owns this worktree
		s, hasSession := branchToSession[wt.Branch]

		// Only flag worktrees whose session is archived or has no session at all
		if hasSession && s.Status != session.StatusArchived {
			continue
		}

		item := Item{
			Kind:   "worktree",
			Name:   filepath.Base(wt.Path),
			Detail: wt.Branch,
		}
		if hasSession {
			item.SessionName = s.Session
			item.Age = time.Since(s.Timestamp)
		}
		items = append(items, item)
	}

	return items, nil
}

func parseWorktreeList(output string) []worktreeInfo {
	var worktrees []worktreeInfo
	var current worktreeInfo

	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if current.Path != "" {
				worktrees = append(worktrees, current)
			}
			current = worktreeInfo{}
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

func scanMergedBranches(repoDir string) ([]Item, error) {
	// Find main branch name
	mainBranch := detectMainBranch(repoDir)

	// Collect branches currently checked out in worktrees to exclude them
	wtCmd := exec.Command("git", "-C", repoDir, "worktree", "list", "--porcelain")
	wtOut, _ := wtCmd.Output()
	checkedOut := make(map[string]bool)
	for _, wt := range parseWorktreeList(string(wtOut)) {
		if wt.Branch != "" {
			checkedOut[wt.Branch] = true
		}
	}

	cmd := exec.Command("git", "-C", repoDir, "branch", "--merged", mainBranch, "--format=%(refname:short)")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var items []Item
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		branch := strings.TrimSpace(scanner.Text())
		if branch == "" || branch == mainBranch || branch == "main" || branch == "master" {
			continue
		}
		// Skip branches currently checked out in a worktree — git branch -d
		// would refuse to delete them anyway, but this avoids confusing errors.
		if checkedOut[branch] {
			continue
		}
		items = append(items, Item{
			Kind:   "branch",
			Name:   branch,
			Detail: fmt.Sprintf("merged into %s", mainBranch),
		})
	}

	return items, nil
}

func detectMainBranch(repoDir string) string {
	// Try to get the default branch from remote
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

func scanDoneSessions() ([]Item, error) {
	all, err := session.ListSessions()
	if err != nil {
		return nil, err
	}

	var items []Item
	for _, s := range all {
		if s.Status != session.StatusArchived {
			continue
		}
		// Skip sessions that still have a live worktree marker
		// (those are covered by the worktree cleanup)
		wt := session.ReadWorktree(s.Session)
		if wt != "" {
			continue
		}
		items = append(items, Item{
			Kind:        "session",
			Name:        s.Session,
			Detail:      s.Summary,
			Age:         time.Since(s.Timestamp),
			SessionName: s.Session,
		})
	}

	return items, nil
}

// ExecuteWorktree removes a stale git worktree.
func ExecuteWorktree(repoDir string, item Item) error {
	// Find the full worktree path
	cmd := exec.Command("git", "-C", repoDir, "worktree", "list", "--porcelain")
	out, err := cmd.Output()
	if err != nil {
		return err
	}

	worktrees := parseWorktreeList(string(out))
	for _, wt := range worktrees {
		if wt.Branch == item.Detail {
			rmCmd := exec.Command("git", "-C", repoDir, "worktree", "remove", wt.Path)
			if err := rmCmd.Run(); err != nil {
				return err
			}
			// Clean up the bertrand worktree marker so the session can be
			// collected by scanDoneSessions on the next cleanup run.
			if item.SessionName != "" {
				os.Remove(session.WorktreePath(item.SessionName))
			}
			return nil
		}
	}
	return fmt.Errorf("worktree for branch %s not found", item.Detail)
}

// ExecuteBranch deletes a merged local branch.
func ExecuteBranch(repoDir string, item Item) error {
	cmd := exec.Command("git", "-C", repoDir, "branch", "-d", item.Name)
	return cmd.Run()
}

// ExecuteSession deletes session data.
func ExecuteSession(item Item) error {
	return session.DeleteSession(item.SessionName)
}
