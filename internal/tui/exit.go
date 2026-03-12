package tui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

// ExitChoice represents the user's selection in the exit menu.
type ExitChoice int

const (
	ExitSave    ExitChoice = iota // Save session
	ExitDiscard                   // Discard session data
	ExitResume                    // Resume the Claude conversation
)

type ExitModel struct {
	name      string
	cursor    int
	choice    ExitChoice
	chosen    bool
	StatusBar StatusBarData
	width     int
}

func NewExitModel(name string) ExitModel {
	return ExitModel{name: name}
}

func (m ExitModel) Choice() ExitChoice { return m.choice }
func (m ExitModel) Chosen() bool       { return m.chosen }

func (m ExitModel) Init() tea.Cmd { return nil }

var exitOptions = []struct {
	label string
	desc  string
}{
	{"Save and exit", "End session and show timeline"},
	{"Discard and exit", "Delete all session data permanently"},
	{"Resume conversation", "Continue where Claude left off"},
}

func (m ExitModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			m.choice = ExitSave
			m.chosen = true
			return m, tea.Quit
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(exitOptions)-1 {
				m.cursor++
			}
		case "enter":
			m.choice = ExitChoice(m.cursor)
			m.chosen = true
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m ExitModel) View() string {
	var b strings.Builder
	b.WriteString("\n")
	b.WriteString(StatusBar(m.StatusBar, m.width))
	b.WriteString("\n")
	b.WriteString(promptStyle.Render(fmt.Sprintf("  Session %s has ended.", m.name)))
	b.WriteString("\n")
	b.WriteString(promptStyle.Render("  What would you like to do?"))
	b.WriteString("\n\n")

	for i, opt := range exitOptions {
		cursor := "  "
		if i == m.cursor {
			cursor = "▸ "
			b.WriteString(fmt.Sprintf("  \033[38;5;120m%s%s\033[0m\n", cursor, opt.label))
			b.WriteString(fmt.Sprintf("    \033[38;5;241m%s\033[0m\n", opt.desc))
		} else {
			b.WriteString(fmt.Sprintf("  \033[38;5;252m%s%s\033[0m\n", cursor, opt.label))
		}
	}
	b.WriteString("\n")
	b.WriteString(hintStyle.Render("  ↑↓ navigate • enter select • q quit"))
	b.WriteString("\n")

	return b.String()
}
