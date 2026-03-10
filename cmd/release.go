package cmd

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
)

var (
	releasePatch  bool
	releaseMinor  bool
	releaseMajor  bool
	releaseDryRun bool
)

var releaseCmd = &cobra.Command{
	Use:   "release",
	Short: "Tag, push, and release a new version",
	Long:  "Bumps the version (default: patch), creates a git tag, pushes to origin, and watches the release workflow.",
	RunE:  runRelease,
}

func init() {
	releaseCmd.Flags().BoolVar(&releasePatch, "patch", false, "Bump patch version (default)")
	releaseCmd.Flags().BoolVar(&releaseMinor, "minor", false, "Bump minor version")
	releaseCmd.Flags().BoolVar(&releaseMajor, "major", false, "Bump major version")
	releaseCmd.Flags().BoolVar(&releaseDryRun, "dry-run", false, "Show what would happen without tagging or pushing")
	rootCmd.AddCommand(releaseCmd)
}

func runRelease(cmd *cobra.Command, args []string) error {
	// Ensure we're on a clean working tree
	out, err := git("status", "--porcelain")
	if err != nil {
		return fmt.Errorf("git status: %w", err)
	}
	if strings.TrimSpace(out) != "" {
		return fmt.Errorf("working tree is dirty — commit or stash changes first")
	}

	// Get latest tag
	latest, err := git("describe", "--tags", "--abbrev=0")
	if err != nil {
		return fmt.Errorf("no existing tags found: %w", err)
	}
	latest = strings.TrimSpace(latest)

	// Parse and bump
	next, err := bumpVersion(latest)
	if err != nil {
		return err
	}

	fmt.Printf("  %s → %s\n", latest, next)

	if releaseDryRun {
		fmt.Println("  (dry run — no changes made)")
		return nil
	}

	// Push any unpushed commits on current branch
	branch, err := git("rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return fmt.Errorf("could not determine branch: %w", err)
	}
	branch = strings.TrimSpace(branch)

	localHead, _ := git("rev-parse", "HEAD")
	remoteHead, _ := git("rev-parse", "origin/"+branch)
	if strings.TrimSpace(localHead) != strings.TrimSpace(remoteHead) {
		fmt.Printf("  pushing %s to origin...\n", branch)
		if _, err := git("push", "origin", branch); err != nil {
			return fmt.Errorf("git push: %w", err)
		}
	}

	// Create and push tag
	fmt.Printf("  tagging %s...\n", next)
	if _, err := git("tag", next); err != nil {
		return fmt.Errorf("git tag: %w", err)
	}
	if _, err := git("push", "origin", next); err != nil {
		return fmt.Errorf("git push tag: %w", err)
	}

	fmt.Printf("  watching release workflow...\n")

	// Watch the release with gh (streams output)
	gh := exec.Command("gh", "run", "watch", "--exit-status")
	gh.Stdout = cmd.OutOrStdout()
	gh.Stderr = cmd.ErrOrStderr()
	if err := gh.Run(); err != nil {
		return fmt.Errorf("release workflow failed: %w", err)
	}

	fmt.Printf("\n  %s released\n", next)
	return nil
}

func bumpVersion(tag string) (string, error) {
	v := strings.TrimPrefix(tag, "v")
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("unexpected tag format: %s", tag)
	}

	major, minor, patch := 0, 0, 0
	if _, err := fmt.Sscanf(parts[0], "%d", &major); err != nil {
		return "", fmt.Errorf("bad major version: %s", parts[0])
	}
	if _, err := fmt.Sscanf(parts[1], "%d", &minor); err != nil {
		return "", fmt.Errorf("bad minor version: %s", parts[1])
	}
	if _, err := fmt.Sscanf(parts[2], "%d", &patch); err != nil {
		return "", fmt.Errorf("bad patch version: %s", parts[2])
	}

	switch {
	case releaseMajor:
		major++
		minor = 0
		patch = 0
	case releaseMinor:
		minor++
		patch = 0
	default:
		patch++
	}

	return fmt.Sprintf("v%d.%d.%d", major, minor, patch), nil
}

func git(args ...string) (string, error) {
	out, err := exec.Command("git", args...).CombinedOutput()
	return string(out), err
}
