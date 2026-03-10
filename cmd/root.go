package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"sync"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/contract"
	"github.com/uiid-systems/bertrand/internal/session"
	"github.com/uiid-systems/bertrand/internal/tui"
)

var (
	ticketPattern   = regexp.MustCompile(`^[A-Z]+-[0-9]+-[a-z0-9-]+$`)
	freeformPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)
)

func printExitMessage(name string, discarded bool) {
	fmt.Print(tui.Goodbye())
	if discarded {
		fmt.Printf("\033[38;5;208m✕\033[0m \033[38;5;252mSession \033[1m%s\033[0m\033[38;5;252m discarded\033[0m\n\n", name)
	} else {
		fmt.Printf("\033[38;5;78m✓\033[0m \033[38;5;252mSession \033[1m%s\033[0m\033[38;5;252m ended\033[0m\n", name)
		fmt.Printf("\033[38;5;241m  Resume with: \033[0m\033[38;5;120mbertrand %s\033[0m\n\n", name)
	}
}

func isInitialized() bool {
	configPath := filepath.Join(session.BaseDir(), "config.yaml")
	_, err := os.Stat(configPath)
	return err == nil
}

var rootCmd = &cobra.Command{
	Use:   "bertrand [session-name]",
	Short: "Agentic workflow manager for Claude Code",
	Long:  "Launch and manage concurrent Claude Code sessions with automatic focus management.",
	Args:  cobra.MaximumNArgs(1),
	ValidArgsFunction: func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		if len(args) > 0 {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		sessions, err := session.ActiveSessions()
		if err != nil {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		var names []string
		for _, s := range sessions {
			names = append(names, s.Session+"\t"+s.Summary)
		}
		return names, cobra.ShellCompDirectiveNoFileComp
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		// Soft clear: move bertrand to top of visible area, preserve scrollback
		fmt.Print("\033[2J\033[H")
		if len(args) == 1 {
			if !isInitialized() {
				return fmt.Errorf("bertrand is not initialized — run: bertrand init")
			}
			return resumeSession(args[0])
		}
		return launchInteractive()
	},
}

func SetVersion(v string) {
	rootCmd.Version = v
	tui.SetVersion(v)
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func launchInteractive() error {
	if !isInitialized() {
		m := tui.NewInitPromptModel()
		p := tea.NewProgram(m)
		result, err := p.Run()
		if err != nil {
			return err
		}
		prompt := result.(tui.InitPromptModel)
		if !prompt.Accepted() || prompt.Quitting() {
			return nil
		}
		return runInitWizard(false)
	}

	sessions, _ := session.ListSessions()

	m := tui.NewLaunchModel(sessions)
	p := tea.NewProgram(m)
	result, err := p.Run()
	if err != nil {
		return err
	}

	launch := result.(tui.LaunchModel)

	// Process any deletions
	for _, name := range launch.Deleted() {
		session.DeleteSession(name)
	}

	if launch.Quitting() || launch.Chosen() == "" {
		return nil
	}

	if launch.IsResume() {
		return resumeSession(launch.Chosen())
	}
	return launchNewSession(launch.Chosen())
}

func launchNewSession(name string) error {
	if !ticketPattern.MatchString(name) && !freeformPattern.MatchString(name) {
		return fmt.Errorf("invalid session name %q — use ticket format (ENG-142-auth-refactor) or freeform (fix-navbar-spacing)", name)
	}

	// Check for existing active session with same name
	if s, err := session.ReadState(name); err == nil {
		if s.Status != session.StatusDone && session.IsProcessAlive(s.PID) {
			return fmt.Errorf("session %q is already active (pid %d)", name, s.PID)
		}
	}

	return runSession(name, "started")
}

// runSession is the shared core for launching and resuming sessions.
// It handles PID registration, Hammerspoon registration, signal trapping,
// subprocess lifecycle, and cleanup.
func runSession(name, verb string) error {
	pid := os.Getpid()

	if err := session.RegisterPID(pid, name); err != nil {
		return fmt.Errorf("failed to register PID: %w", err)
	}
	if err := session.WriteState(name, session.StatusWorking, "Session "+verb, pid); err != nil {
		return fmt.Errorf("failed to write state: %w", err)
	}

	// Write registration marker for Hammerspoon window tracking
	regFile := filepath.Join(session.BaseDir(), "tmp", "register-"+name)
	if err := os.WriteFile(regFile, []byte(name), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to write registration marker: %v\n", err)
	}

	// Set Warp tab/window title to session name
	fmt.Printf("\033]0;bertrand: %s\007", name)

	fmt.Printf("\033[38;5;78m✓\033[0m \033[38;5;252mSession \033[1m%s\033[0m\033[38;5;252m %s\033[0m\n\n", name, verb)

	var cleanupOnce sync.Once
	cleanup := func() {
		cleanupOnce.Do(func() {
			session.CleanupPID(pid)
			os.Remove(filepath.Join(session.SessionsDir(), name, "pending"))

			// Check for exit flow hint files
			_, discardErr := os.Stat(session.DiscardPath(name))
			shouldDiscard := discardErr == nil

			if shouldDiscard {
				session.DeleteSession(name)
			} else {
				summary := session.ReadSummary(name)
				if summary == "" {
					summary = "Session ended"
				}
				session.WriteState(name, session.StatusDone, summary, pid)
				// Clean up the summary hint file
				os.Remove(session.SummaryPath(name))
			}

			active, _ := session.ActiveSessions()
			if len(active) == 0 {
				os.Remove(session.ContractPath())
			}
			printExitMessage(name, shouldDiscard)
		})
	}

	// Trap signals for cleanup
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		cleanup()
		os.Exit(0)
	}()

	claudeCmd := exec.Command("claude", "--append-system-prompt", contract.Template(name))
	claudeCmd.Stdin = os.Stdin
	claudeCmd.Stdout = os.Stdout
	claudeCmd.Stderr = os.Stderr
	claudeCmd.Env = append(os.Environ(),
		fmt.Sprintf("BERTRAND_PID=%d", pid),
		"WARP_DISABLE_AUTO_TITLE=true",
	)

	err := claudeCmd.Run()
	cleanup()
	return err
}

func resumeSession(name string) error {
	if !ticketPattern.MatchString(name) && !freeformPattern.MatchString(name) {
		return fmt.Errorf("invalid session name %q — use ticket format (ENG-142-auth-refactor) or freeform (fix-navbar-spacing)", name)
	}

	s, err := session.ReadState(name)
	if err != nil {
		return fmt.Errorf("session %q not found", name)
	}

	if s.Status != session.StatusDone && session.IsProcessAlive(s.PID) {
		return fmt.Errorf("session %q is still active (pid %d)", name, s.PID)
	}

	return runSession(name, "resumed")
}
