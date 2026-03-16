package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/session"
)

var focusCmd = &cobra.Command{
	Use:   "focus <name>",
	Short: "Focus a session's Wave terminal block",
	Long:  "Reads the session's wave-block-id and calls wsh focusblock to switch to it. Only works within the same Wave tab (project).",
	Args:  cobra.ExactArgs(1),
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
		name := args[0]

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
		focusCmd.Stdout = os.Stdout
		focusCmd.Stderr = os.Stderr
		if err := focusCmd.Run(); err != nil {
			return fmt.Errorf("focusblock failed: %w (session may be on a different tab)", err)
		}

		return nil
	},
}

func init() {
	rootCmd.AddCommand(focusCmd)
}
