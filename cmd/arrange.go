package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/session"
)

var (
	layoutDone  = lipgloss.NewStyle().Foreground(lipgloss.Color("78"))
	layoutLabel = lipgloss.NewStyle().Foreground(lipgloss.Color("252"))
	layoutDim   = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
)

type layout struct {
	name     string
	label    string
	emoji    string
	shortcut string
}

var layouts = []layout{
	{name: "tile", label: "Tile", emoji: "⊞", shortcut: "t"},
	{name: "cascade", label: "Cascade", emoji: "⧉", shortcut: "c"},
}

// --- bubbletea model ---

type arrangeModel struct {
	cursor  int
	chosen  string
	quit    bool
}

func (m arrangeModel) Init() tea.Cmd { return nil }

func (m arrangeModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q", "esc":
			m.quit = true
			return m, tea.Quit
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(layouts)-1 {
				m.cursor++
			}
		case "enter":
			m.chosen = layouts[m.cursor].name
			return m, tea.Quit
		default:
			// Check shortcut keys
			for _, l := range layouts {
				if msg.String() == l.shortcut {
					m.chosen = l.name
					return m, tea.Quit
				}
			}
		}
	}
	return m, nil
}

func (m arrangeModel) View() string {
	titleStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("114")).Bold(true)
	hintStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	activeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("120")).Bold(true)
	inactiveStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("252"))
	shortcutStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("114"))

	s := "\n"
	s += titleStyle.Render("  Arrange windows") + "\n\n"

	for i, l := range layouts {
		cursor := "  "
		style := inactiveStyle
		if m.cursor == i {
			cursor = activeStyle.Render("❯ ")
			style = activeStyle
		}
		s += fmt.Sprintf("  %s%s %s  %s\n",
			cursor,
			style.Render(l.label),
			l.emoji,
			shortcutStyle.Render("["+l.shortcut+"]"),
		)
	}

	s += "\n" + hintStyle.Render("  ↑↓/jk navigate · enter select · shortcut key") + "\n\n"
	return s
}

// --- layout execution ---

func runLayout(name string, emoji string) error {
	signalFile := filepath.Join(session.BaseDir, "tmp", "signal-"+name)
	if err := os.WriteFile(signalFile, []byte(name), 0644); err != nil {
		return err
	}

	frames := []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
	spinStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("114")).Bold(true)

	ackFile := filepath.Join(session.BaseDir, "tmp", "ack-"+name)
	os.Remove(ackFile)
	for i := 0; i < 60; i++ {
		fmt.Printf("\r\033[2K  %s %s",
			spinStyle.Render(frames[i%len(frames)]),
			layoutLabel.Render("Arranging windows..."),
		)
		time.Sleep(80 * time.Millisecond)

		if _, err := os.Stat(ackFile); err == nil {
			os.Remove(ackFile)
			break
		}
	}

	fmt.Printf("\r\033[2K  %s %s %s\n",
		layoutDone.Render("✓"),
		layoutLabel.Render(name+"d"),
		layoutDim.Render(emoji),
	)
	return nil
}

var arrangeCmd = &cobra.Command{
	Use:   "arrange",
	Short: "Arrange session windows (tile or cascade)",
	RunE: func(cmd *cobra.Command, args []string) error {
		m := arrangeModel{}
		p := tea.NewProgram(m)
		result, err := p.Run()
		if err != nil {
			return err
		}

		am := result.(arrangeModel)
		if am.quit || am.chosen == "" {
			return nil
		}

		// Find the chosen layout and run it
		for _, l := range layouts {
			if l.name == am.chosen {
				return runLayout(l.name, l.emoji)
			}
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(arrangeCmd)

	for _, l := range layouts {
		l := l // capture loop var
		arrangeCmd.AddCommand(&cobra.Command{
			Use:   l.name,
			Short: fmt.Sprintf("%s %s windows", l.label, l.emoji),
			Args:  cobra.NoArgs,
			RunE: func(cmd *cobra.Command, args []string) error {
				return runLayout(l.name, l.emoji)
			},
		})
	}
}
