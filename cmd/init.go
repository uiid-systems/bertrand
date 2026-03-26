package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/hooks"
	"github.com/uiid-systems/bertrand/internal/server"
	"github.com/uiid-systems/bertrand/internal/session"
	"github.com/uiid-systems/bertrand/internal/tui"
)

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "First-time setup wizard",
	RunE: func(cmd *cobra.Command, args []string) error {
		return runInitWizard(true)
	},
}

func init() {
	rootCmd.AddCommand(initCmd)
}

func runInitWizard(showLogo bool) error {
	check := "\033[38;5;78m✓\033[0m"
	label := func(s string) string { return fmt.Sprintf("\033[38;5;252m%s\033[0m", s) }
	path := func(s string) string { return fmt.Sprintf("\033[38;5;241m%s\033[0m", s) }
	bold := func(s string) string { return fmt.Sprintf("\033[1;38;5;120m%s\033[0m", s) }
	dim := func(s string) string { return fmt.Sprintf("\033[38;5;241m%s\033[0m", s) }

	// Detect Wave Terminal
	hasWave := false
	if wsh, err := exec.LookPath("wsh"); err == nil {
		hasWave = true
		// Get version for display
		out, _ := exec.Command(wsh, "version").Output()
		ver := strings.TrimSpace(string(out))
		if ver == "" {
			ver = "detected"
		}
		if showLogo {
			fmt.Println(tui.Logo())
		}
		fmt.Printf("%s %s %s\n", check, label("Wave Terminal"), dim("("+ver+")"))
	}

	var choice tui.WizardChoice

	if !hasWave {
		// Non-Wave path: run TUI wizard for terminal selection
		var m tui.WizardModel
		if showLogo {
			m = tui.NewWizardModel()
		} else {
			m = tui.NewWizardModelNoLogo()
		}
		p := tea.NewProgram(m)
		result, err := p.Run()
		if err != nil {
			return err
		}

		wizard := result.(tui.WizardModel)
		if wizard.Quitting() {
			return nil
		}
		choice = wizard.Choice()
	}

	// Install hook scripts
	hooksDir, err := hooks.InstallHooks()
	if err != nil {
		return fmt.Errorf("failed to install hooks: %w", err)
	}
	fmt.Printf("%s %s %s\n", check, label("Hook scripts written to"), path(hooksDir))

	// Inject hooks into Claude Code settings
	if err := hooks.InjectSettings(); err != nil {
		return fmt.Errorf("failed to configure Claude Code hooks: %w", err)
	}
	fmt.Printf("%s %s\n", check, label("Claude Code hooks configured"))

	// Write config
	configPath := filepath.Join(session.BaseDir(), "config.yaml")
	if err := os.MkdirAll(session.BaseDir(), 0755); err != nil {
		return err
	}
	existing, _ := os.ReadFile(configPath)
	existingStr := string(existing)

	var lines []string

	if hasWave {
		lines = append(lines, "terminal: wave")
		lines = append(lines, "wave:")
		lines = append(lines, "  enabled: true")

		// Preserve auto_focus if already set, otherwise default false
		if strings.Contains(existingStr, "auto_focus:") {
			for _, line := range strings.Split(existingStr, "\n") {
				if strings.Contains(line, "auto_focus:") {
					lines = append(lines, "  "+strings.TrimSpace(line))
					break
				}
			}
		} else {
			lines = append(lines, "  auto_focus: false")
		}

		// Preserve focus_delay_ms if set
		if strings.Contains(existingStr, "focus_delay_ms:") {
			for _, line := range strings.Split(existingStr, "\n") {
				if strings.Contains(line, "focus_delay_ms:") {
					lines = append(lines, "  "+strings.TrimSpace(line))
					break
				}
			}
		} else {
			lines = append(lines, "  focus_delay_ms: 1000")
		}

		// Preserve dashboard_port if set
		if strings.Contains(existingStr, "dashboard_port:") {
			for _, line := range strings.Split(existingStr, "\n") {
				if strings.Contains(line, "dashboard_port:") {
					lines = append(lines, "  "+strings.TrimSpace(line))
					break
				}
			}
		} else {
			lines = append(lines, fmt.Sprintf("  dashboard_port: %d", server.DefaultPort))
		}
	} else {
		lines = append(lines, fmt.Sprintf("terminal: %s", choice.Terminal))
	}

	config := strings.Join(lines, "\n") + "\n"
	if err := os.WriteFile(configPath, []byte(config), 0644); err != nil {
		return err
	}
	fmt.Printf("%s %s %s\n", check, label("Config written to"), path(configPath))

	// Install shell completions
	if compPath, err := installCompletions(); err != nil {
		fmt.Fprintf(os.Stderr, "  %s %v\n", label("Shell completions skipped:"), err)
	} else if compPath != "" {
		fmt.Printf("%s %s %s\n", check, label("Shell completions written to"), path(compPath))
	}

	fmt.Printf("\n%s %s\n", bold("Ready."), label("Run: "+bold("bertrand")))
	return nil
}

// installCompletions detects the user's shell and writes the completion script
// by shelling out to `bertrand completion <shell>` to avoid init cycles.
// Returns the path written to, or empty string if shell is unsupported.
func installCompletions() (string, error) {
	shell := os.Getenv("SHELL")
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	var shellName, dir, dest string

	switch {
	case strings.HasSuffix(shell, "/zsh"):
		shellName = "zsh"
		dir = filepath.Join(home, ".zfunc")
		dest = filepath.Join(dir, "_bertrand")
	case strings.HasSuffix(shell, "/bash"):
		shellName = "bash"
		dir = filepath.Join(home, ".local", "share", "bash-completion", "completions")
		dest = filepath.Join(dir, "bertrand")
	case strings.HasSuffix(shell, "/fish"):
		shellName = "fish"
		dir = filepath.Join(home, ".config", "fish", "completions")
		dest = filepath.Join(dir, "bertrand.fish")
	default:
		return "", fmt.Errorf("unsupported shell %q", shell)
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}

	bin, err := os.Executable()
	if err != nil {
		return "", err
	}
	out, err := exec.Command(bin, "completion", shellName).Output()
	if err != nil {
		return "", fmt.Errorf("failed to generate %s completions: %w", shellName, err)
	}
	if err := os.WriteFile(dest, out, 0644); err != nil {
		return "", err
	}

	// For zsh: ensure ~/.zfunc is in fpath
	if shellName == "zsh" {
		zshrc := filepath.Join(home, ".zshrc")
		content, _ := os.ReadFile(zshrc)
		if !strings.Contains(string(content), ".zfunc") {
			f, err := os.OpenFile(zshrc, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
			if err == nil {
				defer f.Close()
				f.WriteString("\n# bertrand completions\nfpath=(~/.zfunc $fpath)\nautoload -Uz compinit && compinit\n")
			}
		}
	}

	return dest, nil
}
