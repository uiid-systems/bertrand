package cmd

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/contract"
	"github.com/uiid-systems/bertrand/internal/hooks"
	sessionlog "github.com/uiid-systems/bertrand/internal/log"
	"github.com/uiid-systems/bertrand/internal/schema"
	"github.com/uiid-systems/bertrand/internal/server"
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

// sessionTimeline reads the session log and renders a compacted pipe timeline.
func sessionTimeline(name string) string {
	d, err := sessionlog.Digest(name)
	if err != nil || len(d.Timeline) == 0 {
		return ""
	}
	return renderTimeline(d.Timeline, d.TimingRaw)
}


// cleanEmptyParents walks up from the deleted session directory and removes
// empty parent directories up to (but not including) the sessions root.
func cleanEmptyParents(deletedPath string) {
	sessionsRoot := session.SessionsDir()
	dir := filepath.Dir(deletedPath)
	for dir != sessionsRoot && dir != "." && dir != "/" {
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) > 0 {
			break
		}
		os.Remove(dir)
		dir = filepath.Dir(dir)
	}
}

func isInitialized() bool {
	configPath := filepath.Join(session.BaseDir(), "config.yaml")
	_, err := os.Stat(configPath)
	return err == nil
}

// serveStateFile returns the path to the serve state file that tracks the
// running dashboard server's PID and web-dir mode.
func serveStateFile() string {
	return filepath.Join(session.BaseDir(), "serve.state")
}

// ensureServeRunning starts bertrand serve as a detached background process
// if the dashboard port is not already listening. When a web/dist directory
// exists in the working directory (dev mode), it passes --web-dir so the
// server serves fresh filesystem assets instead of stale embedded ones.
//
// If a server is already running with embedded assets but web/dist now exists,
// the stale server is killed and restarted with --web-dir.
func ensureServeRunning() {
	addr := fmt.Sprintf("127.0.0.1:%d", server.DefaultPort)
	webDir := resolveWebDir()

	conn, err := net.DialTimeout("tcp", addr, 200*1e6) // 200ms
	if err == nil {
		conn.Close()
		// Server is running. If we're in dev mode, check whether it needs a restart.
		if webDir != "" && shouldRestartServe(webDir) {
			killServe()
		} else {
			return
		}
	}

	// Auto-build: if we're in the source tree but web/dist is missing, build it.
	if webDir == "" {
		if _, err := os.Stat("web/package.json"); err == nil {
			if pnpm, err := exec.LookPath("pnpm"); err == nil {
				build := exec.Command(pnpm, "build")
				build.Dir = "web"
				if build.Run() == nil {
					webDir = resolveWebDir()
				}
			}
		}
	}

	bin, err := os.Executable()
	if err != nil {
		return
	}
	args := []string{"serve"}
	if webDir != "" {
		args = append(args, "--web-dir", webDir)
	}
	cmd := exec.Command(bin, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return
	}

	// Write state file: one line per field so parsing doesn't break on spaces in paths.
	state := fmt.Sprintf("%d\n%s", cmd.Process.Pid, webDir)
	os.WriteFile(serveStateFile(), []byte(state), 0644)
}

// resolveWebDir returns the absolute path to web/dist if it exists in the
// current working directory, or empty string otherwise. Assumes cwd is the
// repo root (bertrand is typically launched from there).
func resolveWebDir() string {
	if info, err := os.Stat("web/dist"); err == nil && info.IsDir() {
		abs, _ := filepath.Abs("web/dist")
		return abs
	}
	return ""
}

// shouldRestartServe checks whether the running server is using embedded assets
// while a web/dist directory is available on disk.
func shouldRestartServe(webDir string) bool {
	data, err := os.ReadFile(serveStateFile())
	if err != nil {
		return false // no state file → assume externally managed, don't kill it
	}
	lines := strings.SplitN(string(data), "\n", 2)
	if len(lines) < 2 || strings.TrimSpace(lines[1]) == "" {
		return true // running in embedded mode → restart with web-dir
	}
	return false // already running with --web-dir
}

// killServe reads the serve state file, kills the running server process, and
// waits for the port to become free before returning.
func killServe() {
	data, err := os.ReadFile(serveStateFile())
	if err != nil {
		return
	}
	lines := strings.SplitN(string(data), "\n", 2)
	pid, err := strconv.Atoi(lines[0])
	if err != nil {
		return
	}
	if p, err := os.FindProcess(pid); err == nil {
		p.Signal(syscall.SIGTERM)
	}
	os.Remove(serveStateFile())

	// Poll until the port is free (the process may not be our child, so
	// Wait() is unreliable). Give up after 2 seconds.
	addr := fmt.Sprintf("127.0.0.1:%d", server.DefaultPort)
	for i := 0; i < 40; i++ {
		conn, err := net.DialTimeout("tcp", addr, 50*1e6) // 50ms
		if err != nil {
			return // port is free
		}
		conn.Close()
		time.Sleep(50 * time.Millisecond)
	}
}

var rootCmd = &cobra.Command{
	Use:   "bertrand [session-name]",
	Short: "Agentic workflow manager for Claude Code",
	Long:  "Launch and manage concurrent Claude Code sessions.",
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

	// Recover sessions whose PID died (crash, force-quit)
	if recovered := session.RecoverStaleSessions(); len(recovered) > 0 {
		noun := "session"
		if len(recovered) > 1 {
			noun = "sessions"
		}
		fmt.Printf("\033[38;5;214m⚑\033[0m \033[38;5;252mRecovered %d stale %s\033[0m\n", len(recovered), noun)
	}

	// Check for stale hooks and auto-reinstall (includes settings + completions)
	if hooks.HooksStale() {
		fmt.Printf("\033[38;5;214m⚑\033[0m \033[38;5;252mHooks updated\033[0m\n")
		if _, err := hooks.InstallHooks(); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to update hooks: %v\n", err)
		} else {
			if err := hooks.InjectSettings(); err != nil {
				fmt.Fprintf(os.Stderr, "warning: failed to update settings: %v\n", err)
			}
			if _, err := installCompletions(); err != nil {
				fmt.Fprintf(os.Stderr, "warning: failed to update completions: %v\n", err)
			}
		}
	}

	allSessions, _ := session.ListSessions()
	// Hide archived sessions from the launch TUI
	var sessions []session.State
	for _, s := range allSessions {
		if s.Status != session.StatusArchived {
			sessions = append(sessions, s)
		}
	}

	m := tui.NewLaunchModel(sessions)
	p := tea.NewProgram(m)
	result, err := p.Run()
	if err != nil {
		return err
	}

	launch := result.(tui.LaunchModel)

	// Process any deletions
	for _, name := range launch.Deleted() {
		if err := session.DeleteSession(name); err != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to delete session %s: %v\n", name, err)
		}
	}
	// Clean up empty parent directories after deletions
	for _, name := range launch.Deleted() {
		cleanEmptyParents(session.SessionDir(name))
	}

	// Process any archives
	for _, name := range launch.Archived() {
		state, err := session.ReadState(name)
		if err != nil {
			continue
		}
		session.WriteState(name, session.StatusArchived, state.Summary, state.PID)
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
	project, ticket, sess, err := session.ParseName(name)
	if err != nil {
		return err
	}
	if !validateNamePart(project) {
		return fmt.Errorf("invalid project name %q — use lowercase letters, numbers, and hyphens", project)
	}
	if ticket != "" && !validateNamePart(ticket) {
		return fmt.Errorf("invalid ticket name %q — use lowercase letters, numbers, and hyphens", ticket)
	}
	if !validateNamePart(sess) {
		return fmt.Errorf("invalid session name %q — use ticket format (ENG-142-auth-refactor) or freeform (fix-navbar-spacing)", sess)
	}

	// Check for existing active session with same name
	if s, err := session.ReadState(name); err == nil {
		if session.IsLive(s.Status) && session.IsProcessAlive(s.PID) {
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
// It handles signal trapping, subprocess lifecycle, exit menu, and cleanup.
func runSession(name, verb string) error {
	return runSessionInner(name, verb, "")
}

func runSessionInner(name, verb, initialClaudeID string) error {
	pid := os.Getpid()

	if err := session.WriteState(name, session.StatusWorking, "Session "+verb, pid); err != nil {
		return fmt.Errorf("failed to write state: %w", err)
	}
	session.AppendEvent(name, "session."+verb, &schema.SessionStartedMeta{PID: fmt.Sprintf("%d", pid)})

	// Set Wave block title and persist block ID for bertrand focus
	if wsh, err := exec.LookPath("wsh"); err == nil {
		exec.Command(wsh, "setmeta", fmt.Sprintf("frame:title=%s", name)).Run()

		// Persist wave-block-id for bertrand focus / dashboard
		if blockID := os.Getenv("WAVETERM_BLOCKID"); blockID != "" {
			os.WriteFile(filepath.Join(session.SessionDir(name), "wave-block-id"), []byte(blockID), 0644)
		}

		// Auto-start bertrand serve if not already running
		ensureServeRunning()
	}

	fmt.Printf("\033[38;5;78m✓\033[0m \033[38;5;252mSession \033[1m%s\033[0m\033[38;5;252m %s\033[0m\n\n", name, verb)

	// cleanupFiles removes transient per-session files (pending marker,
	// worktree marker) and the shared contract when no sessions remain.
	cleanupFiles := func() {
		os.Remove(filepath.Join(session.SessionDir(name), "pending"))
		os.Remove(filepath.Join(session.SessionDir(name), "wave-block-id"))
		os.Remove(session.WorktreePath(name))

		active, _ := session.ActiveSessions()
		if len(active) == 0 {
			os.Remove(session.ContractPath())
		}
	}

	// forceCleaned tracks whether a signal forced cleanup (skip exit menu)
	var forceCleaned bool
	var cleanupOnce sync.Once
	cleanup := func(summary string) {
		cleanupOnce.Do(func() {
			if summary == "" {
				summary = "Session ended"
			}
			session.WriteState(name, session.StatusPaused, summary, pid)
			session.AppendEvent(name, "session.end", &schema.SessionEndMeta{Summary: summary})
			cleanupFiles()
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
		if digest := sessionlog.ContractDigest(name); digest != "" {
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

		case tui.ExitArchive:
			summary := session.ReadSummary(name)
			if summary == "" {
				summary = "Session archived"
			}
			session.WriteState(name, session.StatusArchived, summary, pid)
			session.AppendEvent(name, "session.end", &schema.SessionEndMeta{Summary: summary})
			cleanupFiles()
			printSaveMessage(name, sessionTimeline(name))
			return nil

		case tui.ExitDiscard:
			// Write end event and capture timeline before deleting session data
			session.AppendEvent(name, "session.end", &schema.SessionEndMeta{Summary: "Session discarded"})
			timeline := sessionTimeline(name)
			cleanupFiles()
			session.DeleteSession(name)
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
	// Validate project/session or project/ticket/session format
	if _, _, _, err := session.ParseName(name); err != nil {
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

	if session.IsLive(s.Status) && session.IsProcessAlive(s.PID) {
		return fmt.Errorf("session %q is still active (pid %d)", name, s.PID)
	}

	// Check for previous Claude conversations to offer resume picker.
	// Filter out empty conversations (no user interaction) — these can't be resumed.
	// Loop to support discard — after discarding, re-show the picker.
	for {
		segments := session.ConversationSegments(name)
		var opts []tui.ResumeOption
		for _, seg := range segments {
			if seg.EventCount == 0 {
				continue
			}
			opts = append(opts, tui.ResumeOption{
				ClaudeID:     seg.ClaudeID,
				StartedAt:    seg.StartedAt,
				LastQuestion: seg.LastQuestion,
				EventCount:   seg.EventCount,
				Duration:     seg.EndedAt.Sub(seg.StartedAt),
			})
		}

		if len(opts) == 0 {
			break
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

		if resume.Discarded() {
			if claudeID := resume.DiscardedClaudeID(); claudeID != "" {
				session.DiscardConversation(name, claudeID)
				fmt.Printf("\033[38;5;208m✕\033[0m \033[38;5;252mConversation discarded\033[0m\n")
				continue // re-show picker
			}
		}

		if claudeID := resume.SelectedClaudeID(); claudeID != "" {
			return runSessionWithResume(name, claudeID)
		}
		break
	}

	return runSession(name, "resumed")
}
