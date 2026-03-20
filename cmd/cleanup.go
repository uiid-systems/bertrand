package cmd

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/cleanup"
)

var (
	cleanupDryRun bool
	cleanupForce  bool
)

var cleanupCmd = &cobra.Command{
	Use:   "cleanup",
	Short: "Remove stale worktrees, merged branches, and done sessions",
	RunE:  runCleanup,
}

func init() {
	cleanupCmd.Flags().BoolVar(&cleanupDryRun, "dry-run", false, "Show what would be cleaned without removing anything")
	cleanupCmd.Flags().BoolVar(&cleanupForce, "force", false, "Skip confirmation and remove dirty worktrees")
	rootCmd.AddCommand(cleanupCmd)
}

func runCleanup(cmd *cobra.Command, args []string) error {
	repoDir := findRepoRoot()
	if repoDir == "" {
		return fmt.Errorf("not in a git repository")
	}

	fmt.Printf("\033[38;5;241mScanning...\033[0m\n\n")

	plan, err := cleanup.Scan(repoDir)
	if err != nil {
		return err
	}

	if plan.Empty() {
		fmt.Printf("\033[38;5;78m✓\033[0m \033[38;5;252mNothing to clean up\033[0m\n")
		return nil
	}

	printPlan(plan)

	if cleanupDryRun {
		fmt.Printf("\033[38;5;241m  --dry-run: no changes made\033[0m\n")
		return nil
	}

	if !cleanupForce {
		fmt.Printf("\033[38;5;252mRemove all %d items? \033[38;5;241m[y/N]\033[0m ", plan.Total())
		reader := bufio.NewReader(os.Stdin)
		answer, _ := reader.ReadString('\n')
		answer = strings.TrimSpace(strings.ToLower(answer))
		if answer != "y" && answer != "yes" {
			fmt.Printf("\033[38;5;241mAborted\033[0m\n")
			return nil
		}
		fmt.Println()
	}

	return executePlan(repoDir, plan, cleanupForce)
}

func printPlan(plan *cleanup.Plan) {
	x := "\033[38;5;196m✗\033[0m"
	dim := func(s string) string { return fmt.Sprintf("\033[38;5;241m%s\033[0m", s) }
	label := func(s string) string { return fmt.Sprintf("\033[38;5;252m%s\033[0m", s) }
	warn := func(s string) string { return fmt.Sprintf("\033[38;5;214m%s\033[0m", s) }

	if len(plan.Worktrees) > 0 {
		fmt.Printf("%s\n", label("Stale worktrees:"))
		for _, item := range plan.Worktrees {
			age := formatAge(item.Age)
			session := ""
			if item.SessionName != "" {
				session = fmt.Sprintf(" %s", dim(fmt.Sprintf("(%s — done %s)", item.SessionName, age)))
			}
			flags := ""
			if item.Dirty {
				flags += fmt.Sprintf(" %s", warn("dirty"))
			}
			if item.Merged {
				flags += fmt.Sprintf(" %s", dim("[merged]"))
			}
			fmt.Printf("  %s %s %s%s%s\n", x, label(item.Name), dim(item.Detail), session, flags)
		}
		fmt.Println()
	}

	if len(plan.Branches) > 0 {
		fmt.Printf("%s\n", label("Merged branches:"))
		for _, item := range plan.Branches {
			fmt.Printf("  %s %s %s\n", x, label(item.Name), dim(item.Detail))
		}
		fmt.Println()
	}

	if len(plan.Sessions) > 0 {
		fmt.Printf("%s\n", label("Done sessions:"))
		for _, item := range plan.Sessions {
			age := formatAge(item.Age)
			detail := ""
			if item.Detail != "" && item.Detail != "Session ended" {
				detail = fmt.Sprintf(" — %s", dim(fmt.Sprintf("%q", item.Detail)))
			}
			fmt.Printf("  %s %s %s%s\n", x, label(item.Name), dim(fmt.Sprintf("(done %s)", age)), detail)
		}
		fmt.Println()
	}
}

func executePlan(repoDir string, plan *cleanup.Plan, force bool) error {
	check := "\033[38;5;78m✓\033[0m"
	fail := "\033[38;5;196m✗\033[0m"
	skip := "\033[38;5;214m⚠\033[0m"
	label := func(s string) string { return fmt.Sprintf("\033[38;5;252m%s\033[0m", s) }

	var errors []string
	skipped := 0

	for _, item := range plan.Worktrees {
		if item.Dirty && !force {
			fmt.Printf("  %s %s %s\n", skip, label("worktree "+item.Name), "skipped (dirty — use --force to override)")
			skipped++
			continue
		}
		if err := cleanup.ExecuteWorktree(repoDir, item, force); err != nil {
			fmt.Printf("  %s %s %s\n", fail, label("worktree "+item.Name), err)
			errors = append(errors, fmt.Sprintf("worktree %s: %v", item.Name, err))
		} else {
			fmt.Printf("  %s %s\n", check, label("removed worktree "+item.Name))
		}
	}

	for _, item := range plan.Branches {
		if err := cleanup.ExecuteBranch(repoDir, item); err != nil {
			fmt.Printf("  %s %s %s\n", fail, label("branch "+item.Name), err)
			errors = append(errors, fmt.Sprintf("branch %s: %v", item.Name, err))
		} else {
			fmt.Printf("  %s %s\n", check, label("deleted branch "+item.Name))
		}
	}

	for _, item := range plan.Sessions {
		if err := cleanup.ExecuteSession(item); err != nil {
			fmt.Printf("  %s %s %s\n", fail, label("session "+item.Name), err)
			errors = append(errors, fmt.Sprintf("session %s: %v", item.Name, err))
		} else {
			fmt.Printf("  %s %s\n", check, label("removed session "+item.Name))
		}
	}

	fmt.Println()
	cleaned := plan.Total() - len(errors) - skipped
	if skipped > 0 {
		fmt.Printf("\033[38;5;214m⚠\033[0m \033[38;5;252m%d items skipped (dirty worktrees)\033[0m\n", skipped)
	}
	if len(errors) > 0 {
		fmt.Printf("\033[38;5;214m⚠\033[0m \033[38;5;252m%d of %d items failed\033[0m\n", len(errors), plan.Total())
		return fmt.Errorf("%d items failed to clean up", len(errors))
	}

	fmt.Printf("\033[38;5;78m✓\033[0m \033[38;5;252mCleaned up %d items\033[0m\n", cleaned)
	return nil
}

func formatAge(d time.Duration) string {
	hours := d.Hours()
	if hours < 1 {
		return "just now"
	}
	if hours < 24 {
		return fmt.Sprintf("%dh ago", int(hours))
	}
	days := int(hours / 24)
	if days == 1 {
		return "1d ago"
	}
	return fmt.Sprintf("%dd ago", days)
}

func findRepoRoot() string {
	cmd := exec.Command("git", "rev-parse", "--show-toplevel")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
