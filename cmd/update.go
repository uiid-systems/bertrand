package cmd

import (
	"fmt"
	"os"
	"strconv"

	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/session"
)

var (
	updateName     string
	updateStatus   string
	updateSummary  string
	updateRegister bool
)

var updateCmd = &cobra.Command{
	Use:    "update",
	Short:  "Write session state (agent-facing)",
	Hidden: true,
	RunE:   runUpdate,
}

func init() {
	updateCmd.Flags().StringVar(&updateName, "name", "", "Session name")
	updateCmd.Flags().StringVar(&updateStatus, "status", "", "Session status (working, blocked, done)")
	updateCmd.Flags().StringVar(&updateSummary, "summary", "", "Short description of current state")
	updateCmd.Flags().BoolVar(&updateRegister, "register", false, "Register a new session")
	rootCmd.AddCommand(updateCmd)
}

func runUpdate(cmd *cobra.Command, args []string) error {
	if updateName == "" {
		return fmt.Errorf("--name is required")
	}

	// Get the parent PID — this is the bertrand wrapper that launched Claude Code
	pidStr := os.Getenv("BERTRAND_PID")
	pid := 0
	if pidStr != "" {
		pid, _ = strconv.Atoi(pidStr)
	}

	if updateRegister {
		// Agent is registering its session name
		if pid > 0 {
			if err := session.RegisterPID(pid, updateName); err != nil {
				return fmt.Errorf("failed to register session: %w", err)
			}
		}
		status := updateStatus
		if status == "" {
			status = session.StatusWorking
		}
		summary := updateSummary
		if summary == "" {
			summary = "Session started"
		}
		return session.WriteState(updateName, status, summary, pid)
	}

	if updateStatus == "" {
		return fmt.Errorf("--status is required")
	}
	if updateSummary == "" {
		return fmt.Errorf("--summary is required")
	}

	return session.WriteState(updateName, updateStatus, updateSummary, pid)
}
