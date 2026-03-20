package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/session"
)

var reviewEditor string
var reviewAll bool

var reviewCmd = &cobra.Command{
	Use:   "review [name]",
	Short: "Open a session's worktree in an editor for diff review",
	Long:  "Resolves the session's worktree directory and opens it in Cursor (or another editor via --editor). Use --all to open all active worktrees as a multi-root workspace.",
	Args:  cobra.MaximumNArgs(1),
	ValidArgsFunction: func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		if len(args) > 0 {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		return sessionsWithWorktrees(), cobra.ShellCompDirectiveNoFileComp
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		editor := reviewEditor
		if editor == "" {
			editor = "cursor"
		}

		if _, err := exec.LookPath(editor); err != nil {
			return fmt.Errorf("%s not found on PATH", editor)
		}

		if reviewAll {
			return reviewAllWorktrees(editor)
		}

		if len(args) == 0 {
			return fmt.Errorf("specify a session name or use --all")
		}

		return reviewSession(args[0], editor)
	},
}

func reviewSession(name, editor string) error {
	branch := session.ReadWorktree(name)
	if branch == "" {
		return fmt.Errorf("session %q has no active worktree", name)
	}

	repoDir := findRepoRoot()
	if repoDir == "" {
		return fmt.Errorf("not in a git repository")
	}

	wtPath, err := session.ResolveWorktreePath(repoDir, branch)
	if err != nil {
		return err
	}

	editorCmd := exec.Command(editor, "-n", wtPath)
	editorCmd.Stdout = os.Stdout
	editorCmd.Stderr = os.Stderr
	if err := editorCmd.Start(); err != nil {
		return fmt.Errorf("failed to open %s: %w", editor, err)
	}

	fmt.Printf("Opened %s in %s\n", name, editor)
	return nil
}

func reviewAllWorktrees(editor string) error {
	repoDir := findRepoRoot()
	if repoDir == "" {
		return fmt.Errorf("not in a git repository")
	}

	all, err := session.ListSessions()
	if err != nil {
		return fmt.Errorf("listing sessions: %w", err)
	}

	type entry struct {
		name string
		path string
	}

	var entries []entry
	for _, s := range all {
		branch := session.ReadWorktree(s.Session)
		if branch == "" {
			continue
		}
		wtPath, err := session.ResolveWorktreePath(repoDir, branch)
		if err != nil {
			continue
		}
		entries = append(entries, entry{name: s.Session, path: wtPath})
	}

	if len(entries) == 0 {
		return fmt.Errorf("no sessions with active worktrees found")
	}

	// Generate .code-workspace file
	type folder struct {
		Name string `json:"name,omitempty"`
		Path string `json:"path"`
	}
	type workspace struct {
		Folders  []folder               `json:"folders"`
		Settings map[string]interface{} `json:"settings"`
	}

	ws := workspace{
		Settings: map[string]interface{}{},
	}
	for _, e := range entries {
		ws.Folders = append(ws.Folders, folder{
			Name: e.name,
			Path: e.path,
		})
	}

	data, err := json.MarshalIndent(ws, "", "  ")
	if err != nil {
		return fmt.Errorf("marshalling workspace: %w", err)
	}

	wsPath := filepath.Join(session.BaseDir(), "review.code-workspace")
	if err := os.WriteFile(wsPath, data, 0644); err != nil {
		return fmt.Errorf("writing workspace file: %w", err)
	}

	editorCmd := exec.Command(editor, wsPath)
	editorCmd.Stdout = os.Stdout
	editorCmd.Stderr = os.Stderr
	if err := editorCmd.Start(); err != nil {
		return fmt.Errorf("failed to open %s: %w", editor, err)
	}

	fmt.Printf("Opened %d worktrees in %s\n", len(entries), editor)
	return nil
}

// sessionsWithWorktrees returns session names that have an active worktree marker.
func sessionsWithWorktrees() []string {
	all, err := session.ListSessions()
	if err != nil {
		return nil
	}
	var names []string
	for _, s := range all {
		if session.ReadWorktree(s.Session) != "" {
			names = append(names, s.Session+"\t"+s.Summary)
		}
	}
	return names
}

func init() {
	reviewCmd.Flags().StringVar(&reviewEditor, "editor", "", "editor to open worktree in (default: cursor)")
	reviewCmd.Flags().BoolVar(&reviewAll, "all", false, "open all active worktrees as a multi-root workspace")
	rootCmd.AddCommand(reviewCmd)
}
