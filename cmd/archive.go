package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/session"
)

var allPaused bool

var archiveCmd = &cobra.Command{
	Use:   "archive [name]",
	Short: "Archive a paused session",
	Long:  "Mark a paused session as archived (truly finished). Archived sessions are eligible for cleanup.",
	Args:  cobra.MaximumNArgs(1),
	RunE:  runArchive,
	ValidArgsFunction: func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		if len(args) > 0 {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		return completePausedSessions(toComplete), cobra.ShellCompDirectiveNoFileComp
	},
}

var unarchiveCmd = &cobra.Command{
	Use:   "unarchive <name>",
	Short: "Unarchive a session back to paused",
	Args:  cobra.ExactArgs(1),
	RunE:  runUnarchive,
	ValidArgsFunction: func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		if len(args) > 0 {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		return completeArchivedSessions(toComplete), cobra.ShellCompDirectiveNoFileComp
	},
}

func init() {
	archiveCmd.Flags().BoolVar(&allPaused, "all-paused", false, "Archive all paused sessions")
	rootCmd.AddCommand(archiveCmd)
	rootCmd.AddCommand(unarchiveCmd)
}

func runArchive(cmd *cobra.Command, args []string) error {
	if allPaused {
		return archiveAllPaused()
	}
	if len(args) == 0 {
		return fmt.Errorf("session name required (or use --all-paused)")
	}

	name := args[0]
	s, err := session.ReadState(name)
	if err != nil {
		return fmt.Errorf("session %q not found", name)
	}

	if session.IsLive(s.Status) {
		return fmt.Errorf("cannot archive live session %q (status: %s) — end the session first", name, s.Status)
	}
	if s.Status == session.StatusArchived {
		return fmt.Errorf("session %q is already archived", name)
	}

	if err := session.WriteState(name, session.StatusArchived, s.Summary, s.PID); err != nil {
		return err
	}
	fmt.Printf("Archived %s\n", name)
	return nil
}

func runUnarchive(cmd *cobra.Command, args []string) error {
	name := args[0]
	s, err := session.ReadState(name)
	if err != nil {
		return fmt.Errorf("session %q not found", name)
	}

	if s.Status != session.StatusArchived {
		return fmt.Errorf("session %q is not archived (status: %s)", name, s.Status)
	}

	if err := session.WriteState(name, session.StatusPaused, s.Summary, s.PID); err != nil {
		return err
	}
	fmt.Printf("Unarchived %s → paused\n", name)
	return nil
}

func archiveAllPaused() error {
	sessions, err := session.ListSessions()
	if err != nil {
		return err
	}

	count := 0
	for _, s := range sessions {
		if s.Status != session.StatusPaused {
			continue
		}
		if err := session.WriteState(s.Session, session.StatusArchived, s.Summary, s.PID); err != nil {
			fmt.Printf("  failed: %s: %v\n", s.Session, err)
			continue
		}
		fmt.Printf("  archived %s\n", s.Session)
		count++
	}

	if count == 0 {
		fmt.Println("No paused sessions to archive.")
	} else {
		fmt.Printf("Archived %d session(s).\n", count)
	}
	return nil
}

func completePausedSessions(toComplete string) []string {
	sessions, err := session.ListSessions()
	if err != nil {
		return nil
	}
	var names []string
	for _, s := range sessions {
		if s.Status == session.StatusPaused {
			names = append(names, s.Session)
		}
	}
	return names
}

func completeArchivedSessions(toComplete string) []string {
	sessions, err := session.ListSessions()
	if err != nil {
		return nil
	}
	var names []string
	for _, s := range sessions {
		if s.Status == session.StatusArchived {
			names = append(names, s.Session)
		}
	}
	return names
}
