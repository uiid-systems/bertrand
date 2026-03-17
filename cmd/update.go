package cmd

import (
	"fmt"
	"os"
	"strconv"

	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/session"
)

var (
	updateName    string
	updateStatus  string
	updateSummary string
)

var updateCmd = &cobra.Command{
	Use:    "update",
	Short:  "Write session state (agent-facing)",
	Hidden: true,
	RunE:   runUpdate,
}

func init() {
	updateCmd.Flags().StringVar(&updateName, "name", "", "Session name")
	updateCmd.Flags().StringVar(&updateStatus, "status", "", "Session status (working, blocked, prompting, paused, archived)")
	updateCmd.Flags().StringVar(&updateSummary, "summary", "", "Short description of current state")
	rootCmd.AddCommand(updateCmd)
}

func runUpdate(cmd *cobra.Command, args []string) error {
	if updateName == "" {
		return fmt.Errorf("--name is required")
	}

	if updateStatus == "" {
		return fmt.Errorf("--status is required")
	}
	if updateSummary == "" {
		return fmt.Errorf("--summary is required")
	}

	// Get the bertrand wrapper PID for state.json (used for process-alive checks)
	pid := 0
	if pidStr := os.Getenv("BERTRAND_PID"); pidStr != "" {
		pid, _ = strconv.Atoi(pidStr)
	}

	return session.WriteState(updateName, updateStatus, updateSummary, pid)
}
