package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/contract"
	"github.com/uiid-systems/bertrand/internal/hooks"
	"github.com/uiid-systems/bertrand/internal/schema"
	"github.com/uiid-systems/bertrand/internal/session"
	"github.com/uiid-systems/bertrand/internal/tui"
)

var (
	ticketPattern   = regexp.MustCompile(`^[A-Z]+-[0-9]+-[a-z0-9-]+$`)
	freeformPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)
)

// validateNamePart checks if a single name part (project or session) is valid.
func validateNamePart(part string) bool {
	return ticketPattern.MatchString(part) || freeformPattern.MatchString(part)
}

// regFilename returns a safe filename for the Hammerspoon registration marker.
// Replaces "/" with "___" since filenames can't contain slashes.
// Uses triple underscore to avoid collision with valid hyphens in names.
func regFilename(name string) string {
	return "register-" + strings.ReplaceAll(name, "/", "___")
}

func printSaveMessage(name string, timeline string) {
	fmt.Print(tui.Goodbye())
	fmt.Printf("\033[38;5;78m✓\033[0m \033[38;5;252mSession \033[1m%s\033[0m\033[38;5;252m saved\033[0m\n", name)
	if timeline != "" {
		fmt.Print(timeline)
	}
	fmt.Printf("\033[38;5;241m  Resume with: \033[0m\033[38;5;120mbertrand %s\033[0m\n\n", name)
}

func printDiscardMessage(name string, timeline string) {
	fmt.Print(tui.Goodbye())
	fmt.Printf("\033[38;5;208m✕\033[0m \033[38;5;252mSession \033[1m%s\033[0m\033[38;5;252m discarded\033[0m\n", name)
	if timeline != "" {
		fmt.Print(timeline)
	}
	fmt.Println()
}

// sessionTimeline reads the session log and renders a pipe timeline.
func sessionTimeline(name string) string {
	typedEvents, err := readTypedLog(name)
	if err != nil || len(typedEvents) == 0 {
		return ""
	}
	var entries []unifiedEntry
	for _, te := range typedEvents {
		entries = append(entries, unifiedEntry{
			Event:   te.Event,
			Session: te.Session,
			TS:      te.TS,
			Summary: te.MetaSummary(),
		})
	}
	timing := schema.ComputeTimings(typedEvents)
	return renderTimeline(entries, timing)
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

	// Migrate flat sessions from pre-project era
	if _, err := session.MigrateFlatSessions(); err != nil {
		fmt.Fprintf(os.Stderr, "warning: session migration incomplete: %v\n", err)
	}

	// Check for stale hooks and auto-reinstall
	if hooks.HooksStale() {
		fmt.Printf("\033[38;5;214m⚑\033[0m \033[38;5;252mHooks updated\033[0m\n")
		if _, err := hooks.InstallHooks(); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to update hooks: %v\n", err)
		}
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
	project, sess, err := session.ParseName(name)
	if err != nil {
		return err
	}
	if !validateNamePart(project) {
		return fmt.Errorf("invalid project name %q — use lowercase letters, numbers, and hyphens", project)
	}
	if !validateNamePart(sess) {
		return fmt.Errorf("invalid session name %q — use ticket format (ENG-142-auth-refactor) or freeform (fix-navbar-spacing)", sess)
	}

	// Check for existing active session with same name
	if s, err := session.ReadState(name); err == nil {
		if s.Status != session.StatusDone && session.IsProcessAlive(s.PID) {
			return fmt.Errorf("session %q is already active (pid %d)", name, s.PID)
		}
	}

	return runSession(name, "started")
}

// runSessionWithResume launches a session that begins by resuming a specific Claude conversation.
func runSessionWithResume(name, claudeID string) error {
	return runSessionInner(name, "resumed", claudeID)
}

// runSession is the shared core for launching and resuming sessions.
// It handles PID registration, Hammerspoon registration, signal trapping,
// subprocess lifecycle, exit menu, and cleanup.
func runSession(name, verb string) error {
	return runSessionInner(name, verb, "")
}

func runSessionInner(name, verb, initialClaudeID string) error {
	pid := os.Getpid()

	if err := session.RegisterPID(pid, name); err != nil {
		return fmt.Errorf("failed to register PID: %w", err)
	}
	if err := session.WriteState(name, session.StatusWorking, "Session "+verb, pid); err != nil {
		return fmt.Errorf("failed to write state: %w", err)
	}
	session.AppendEvent(name, "session."+verb, &schema.SessionStartedMeta{PID: fmt.Sprintf("%d", pid)})

	// Write registration marker for Hammerspoon window tracking
	regFile := filepath.Join(session.BaseDir(), "tmp", regFilename(name))
	if err := os.WriteFile(regFile, []byte(name), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to write registration marker: %v\n", err)
	}

	// Set Warp tab/window title to session name
	fmt.Printf("\033]0;bertrand: %s\007", name)

	fmt.Printf("\033[38;5;78m✓\033[0m \033[38;5;252mSession \033[1m%s\033[0m\033[38;5;252m %s\033[0m\n\n", name, verb)

	// forceCleaned tracks whether a signal forced cleanup (skip exit menu)
	var forceCleaned bool
	var cleanupOnce sync.Once
	cleanup := func(summary string) {
		cleanupOnce.Do(func() {
			if summary == "" {
				summary = "Session ended"
			}
			session.WriteState(name, session.StatusDone, summary, pid)
			session.AppendEvent(name, "session.end", &schema.SessionEndMeta{Summary: summary})
			session.CleanupPID(pid)
			os.Remove(filepath.Join(session.SessionDir(name), "pending"))
			os.Remove(session.WorktreePath(name))

			active, _ := session.ActiveSessions()
			if len(active) == 0 {
				os.Remove(session.ContractPath())
			}
		})
	}

	// Trap signals — force cleanup without exit menu
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		forceCleaned = true
		cleanup("Session ended")
		printSaveMessage(name, sessionTimeline(name))
		os.Exit(0)
	}()

	// Build context layers for contract injection
	contextLayers := func() []string {
		var layers []string
		if digest := session.LogDigest(name); digest != "" {
			layers = append(layers, digest)
		}
		if siblings := session.SiblingSummaries(name); siblings != "" {
			layers = append(layers, siblings)
		}
		return layers
	}

	// Launch Claude — loop supports "Resume conversation" from exit menu
	var resumeClaudeID string // set when user picks "Resume" from exit menu or resume picker
	if initialClaudeID != "" {
		resumeClaudeID = initialClaudeID
	}
	for {
		tmpl := contract.Template(name, contextLayers()...)

		var claudeCmd *exec.Cmd
		var claudeID string
		statuslineSettings := hooks.StatuslineSettingsJSON()
		if resumeClaudeID != "" {
			claudeID = resumeClaudeID
			claudeCmd = exec.Command("claude", "--resume", claudeID, "--settings", statuslineSettings, "--append-system-prompt", tmpl)
		} else {
			claudeID = session.NewClaudeID()
			claudeCmd = exec.Command("claude", "--session-id", claudeID, "--settings", statuslineSettings, "--append-system-prompt", tmpl)
		}
		claudeCmd.Stdin = os.Stdin
		claudeCmd.Stdout = os.Stdout
		claudeCmd.Stderr = os.Stderr
		claudeCmd.Env = append(os.Environ(),
			fmt.Sprintf("BERTRAND_PID=%d", pid),
			fmt.Sprintf("BERTRAND_CLAUDE_ID=%s", claudeID),
			fmt.Sprintf("BERTRAND_SESSION=%s", name),
			"WARP_DISABLE_AUTO_TITLE=true",
		)

		session.AppendEvent(name, "claude.started", &schema.ClaudeIDMeta{ClaudeID: claudeID})

		claudeCmd.Run()

		session.AppendEvent(name, "claude.ended", &schema.ClaudeIDMeta{ClaudeID: claudeID})

		// If signal handler already ran, we're done
		if forceCleaned {
			return nil
		}

		// Show exit menu
		m := tui.NewExitModel(name)

		p := tea.NewProgram(m)
		result, err := p.Run()
		if err != nil {
			cleanup("Session ended")
			printSaveMessage(name, sessionTimeline(name))
			return err
		}

		exit := result.(tui.ExitModel)

		if !exit.Chosen() {
			// Menu closed without selection — default to save
			cleanup("Session ended")
			printSaveMessage(name, sessionTimeline(name))
			return nil
		}

		switch exit.Choice() {
		case tui.ExitSave:
			cleanup("Session ended")
			printSaveMessage(name, sessionTimeline(name))
			return nil

		case tui.ExitDiscard:
			// Write end event and capture timeline before deleting session data
			session.AppendEvent(name, "session.end", &schema.SessionEndMeta{Summary: "Session discarded"})
			timeline := sessionTimeline(name)
			session.CleanupPID(pid)
			os.Remove(filepath.Join(session.SessionDir(name), "pending"))
			os.Remove(session.WorktreePath(name))
			session.DeleteSession(name)
			active, _ := session.ActiveSessions()
			if len(active) == 0 {
				os.Remove(session.ContractPath())
			}
			printDiscardMessage(name, timeline)
			return nil

		case tui.ExitResume:
			// Re-enter the loop, resuming this Claude conversation
			resumeClaudeID = claudeID
			session.WriteState(name, session.StatusWorking, "Session resumed", pid)
			fmt.Printf("\n\033[38;5;78m✓\033[0m \033[38;5;252mResuming conversation...\033[0m\n\n")
			continue
		}
	}
}

func resumeSession(name string) error {
	// Validate project/session format
	if _, _, err := session.ParseName(name); err != nil {
		// Accept flat names for CLI resume of legacy sessions
		if !validateNamePart(name) {
			return fmt.Errorf("invalid session name %q — use project/session format (e.g., bertrand/tinkering)", name)
		}
		// Try legacy/ prefix for migrated flat sessions
		legacyName := "legacy/" + name
		if _, err := session.ReadState(legacyName); err == nil {
			name = legacyName
		}
	}

	s, err := session.ReadState(name)
	if err != nil {
		return fmt.Errorf("session %q not found", name)
	}

	if s.Status != session.StatusDone && session.IsProcessAlive(s.PID) {
		return fmt.Errorf("session %q is still active (pid %d)", name, s.PID)
	}

	// Check for previous Claude conversations to offer resume picker
	segments := session.ConversationSegments(name)
	if len(segments) > 0 {
		var opts []tui.ResumeOption
		for _, seg := range segments {
			opts = append(opts, tui.ResumeOption{
				ClaudeID:     seg.ClaudeID,
				StartedAt:    seg.StartedAt,
				LastQuestion: seg.LastQuestion,
				EventCount:   seg.EventCount,
				Duration:     seg.EndedAt.Sub(seg.StartedAt),
			})
		}

		m := tui.NewResumeModel(name, opts)

		p := tea.NewProgram(m)
		result, err := p.Run()
		if err != nil {
			return err
		}

		resume := result.(tui.ResumeModel)
		if resume.Quitting() {
			return nil
		}

		if claudeID := resume.SelectedClaudeID(); claudeID != "" {
			return runSessionWithResume(name, claudeID)
		}
	}

	return runSession(name, "resumed")
}
