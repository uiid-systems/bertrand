package tui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

// ExitChoice represents the user's selection in the exit menu.
type ExitChoice int

const (
	ExitSave    ExitChoice = iota // Save session with a description
	ExitDiscard                   // Discard session data
	ExitResume                    // Resume the Claude conversation
)

type ExitModel struct {
	name     string
	cursor   int
	choice   ExitChoice
	chosen   bool
	quitting bool

	// Text input for save description
	editing     bool
	description string
}

func NewExitModel(name string) ExitModel {
	return ExitModel{name: name}
}

func (m ExitModel) Choice() ExitChoice  { return m.choice }
func (m ExitModel) Chosen() bool        { return m.chosen }
func (m ExitModel) Quitting() bool      { return m.quitting }
func (m ExitModel) Description() string { return m.description }

func (m ExitModel) Init() tea.Cmd { return nil }

var exitOptions = []struct {
	label string
	desc  string
}{
	{"Save and exit", "End session with a description for future reference"},
	{"Discard and exit", "Delete all session data permanently"},
	{"Resume conversation", "Continue where Claude left off"},
}

func (m ExitModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.editing {
			return m.updateEditing(msg)
		}
		return m.updateMenu(msg)
	}
	return m, nil
}

func (m ExitModel) updateMenu(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c", "q":
		m.choice = ExitSave
		m.chosen = true
		m.quitting = true
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
		switch m.choice {
		case ExitSave:
			m.editing = true
			return m, nil
		case ExitDiscard, ExitResume:
			m.chosen = true
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m ExitModel) updateEditing(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c":
		m.quitting = true
		m.chosen = true
		return m, tea.Quit
	case "escape":
		m.editing = false
		m.description = ""
		return m, nil
	case "enter":
		m.chosen = true
		return m, tea.Quit
	case "backspace":
		if len(m.description) > 0 {
			m.description = m.description[:len(m.description)-1]
		}
	default:
		if len(msg.String()) == 1 || msg.String() == " " {
			if len(m.description) < 120 {
				m.description += msg.String()
			}
		}
	}
	return m, nil
}

func (m ExitModel) View() string {
	if m.quitting && m.chosen {
		return ""
	}

	var b strings.Builder
	b.WriteString("\n")
	b.WriteString(promptStyle.Render(fmt.Sprintf("  Session %s has ended.", m.name)))
	b.WriteString("\n")
	b.WriteString(promptStyle.Render("  What would you like to do?"))
	b.WriteString("\n\n")

	if m.editing {
		b.WriteString(m.viewEditing())
	} else {
		b.WriteString(m.viewMenu())
	}

	return b.String()
}

func (m ExitModel) viewMenu() string {
	var b strings.Builder
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

func (m ExitModel) viewEditing() string {
	var b strings.Builder
	b.WriteString(promptStyle.Render("  Describe what you accomplished (optional):"))
	b.WriteString("\n\n")
	b.WriteString(fmt.Sprintf("  \033[38;5;252m> %s\033[38;5;241m█\033[0m\n", m.description))
	b.WriteString("\n")
	b.WriteString(hintStyle.Render("  enter save • esc go back"))
	b.WriteString("\n")
	return b.String()
}
