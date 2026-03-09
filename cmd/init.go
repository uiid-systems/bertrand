package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/hooks"
	"github.com/uiid-systems/bertrand/internal/session"
	"github.com/uiid-systems/bertrand/internal/tui"
)

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "First-time setup wizard",
	RunE:  runInit,
}

func init() {
	rootCmd.AddCommand(initCmd)
}

func runInit(cmd *cobra.Command, args []string) error {
	m := tui.NewWizardModel()
	p := tea.NewProgram(m)
	result, err := p.Run()
	if err != nil {
		return err
	}

	wizard := result.(tui.WizardModel)
	if wizard.Quitting() {
		return nil
	}

	choice := wizard.Choice()

	check := "\033[38;5;78m✓\033[0m"
	label := func(s string) string { return fmt.Sprintf("\033[38;5;252m%s\033[0m", s) }
	path := func(s string) string { return fmt.Sprintf("\033[38;5;241m%s\033[0m", s) }
	bold := func(s string) string { return fmt.Sprintf("\033[1;38;5;120m%s\033[0m", s) }

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
	configPath := filepath.Join(session.BaseDir, "config.yaml")
	if err := os.MkdirAll(session.BaseDir, 0755); err != nil {
		return err
	}
	config := fmt.Sprintf("terminal: %s\nfocus_queue: %v\n", choice.Terminal, choice.EnableFocusQueue)
	if err := os.WriteFile(configPath, []byte(config), 0644); err != nil {
		return err
	}
	fmt.Printf("%s %s %s\n", check, label("Config written to"), path(configPath))

	// Hammerspoon setup
	if choice.EnableFocusQueue {
		hsPath := choice.HammerspoonPath
		if strings.HasPrefix(hsPath, "~") {
			home, _ := os.UserHomeDir()
			hsPath = filepath.Join(home, hsPath[1:])
		}

		if err := os.MkdirAll(hsPath, 0755); err != nil {
			return fmt.Errorf("failed to create Hammerspoon config dir: %w", err)
		}

		luaPath := filepath.Join(hsPath, "bertrand.lua")
		if err := os.WriteFile(luaPath, []byte(hooks.HammerspoonConfig()), 0644); err != nil {
			return fmt.Errorf("failed to write Hammerspoon config: %w", err)
		}
		fmt.Printf("%s %s %s\n", check, label("Hammerspoon config written to"), path(luaPath))

		// Auto-inject into init.lua
		initLua := filepath.Join(hsPath, "init.lua")
		content, err := os.ReadFile(initLua)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if !strings.Contains(string(content), "bertrand") {
			injection := "\n-- bertrand: focus queue\nlocal bertrand = require(\"bertrand\")\nbertrand.start()\n"
			f, err := os.OpenFile(initLua, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
			if err != nil {
				return fmt.Errorf("failed to update init.lua: %w", err)
			}
			defer f.Close()
			if _, err := f.WriteString(injection); err != nil {
				return fmt.Errorf("failed to update init.lua: %w", err)
			}
			fmt.Printf("%s %s %s\n", check, label("Hammerspoon init.lua updated"), path(initLua))
		}
	}

	fmt.Printf("\n%s %s\n", bold("Ready."), label("Run: "+bold("bertrand")))
	return nil
}
