package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"

	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/session"
)

var focusNext bool

var focusCmd = &cobra.Command{
	Use:   "focus [name]",
	Short: "Focus a session's Wave terminal block",
	Long:  "Reads the session's wave-block-id and calls wsh focusblock to switch to it. With --next, focuses the oldest blocked session.",
	Args:  cobra.MaximumNArgs(1),
	ValidArgsFunction: func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		if len(args) > 0 {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		active, err := session.ActiveSessions()
		if err != nil {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		var names []string
		for _, s := range active {
			names = append(names, s.Session+"\t"+s.Summary)
		}
		return names, cobra.ShellCompDirectiveNoFileComp
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		var name string

		if focusNext {
			// Find the oldest blocked session
			blocked, err := blockedSessions()
			if err != nil || len(blocked) == 0 {
				return nil // nothing blocked, silent exit
			}
			name = blocked[0].Session
		} else if len(args) == 1 {
			name = args[0]
		} else {
			return fmt.Errorf("specify a session name or use --next")
		}

		if err := focusBlock(name); err != nil {
			return err
		}

		// Print the focused session name so callers can capture it
		fmt.Print(name)
		return nil
	},
}

func focusBlock(name string) error {
	blockIDPath := session.SessionDir(name) + "/wave-block-id"
	data, err := os.ReadFile(blockIDPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("session %q has no wave-block-id (not running in Wave?)", name)
		}
		return fmt.Errorf("reading wave-block-id: %w", err)
	}

	blockID := strings.TrimSpace(string(data))
	if blockID == "" {
		return fmt.Errorf("wave-block-id is empty for session %q", name)
	}

	wsh, err := exec.LookPath("wsh")
	if err != nil {
		return fmt.Errorf("wsh not found — focus requires Wave Terminal")
	}

	focusCmd := exec.Command(wsh, "focusblock", "-b", blockID)
	focusCmd.Stdout = nil
	focusCmd.Stderr = os.Stderr
	if err := focusCmd.Run(); err != nil {
		return fmt.Errorf("focusblock failed: %w (session may be on a different tab)", err)
	}

	return nil
}

// blockedSessions returns all blocked sessions sorted by timestamp (oldest first).
func blockedSessions() ([]session.State, error) {
	all, err := session.ListSessions()
	if err != nil {
		return nil, err
	}

	var blocked []session.State
	for _, s := range all {
		if s.Status == session.StatusBlocked {
			blocked = append(blocked, s)
		}
	}

	sort.Slice(blocked, func(i, j int) bool {
		return blocked[i].Timestamp.Before(blocked[j].Timestamp)
	})

	return blocked, nil
}

func init() {
	focusCmd.Flags().BoolVar(&focusNext, "next", false, "focus the oldest blocked session")
	rootCmd.AddCommand(focusCmd)
}
