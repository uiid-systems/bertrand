package tui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
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

type exitOption struct {
	icon     string
	label    string
	desc     string
	accent   lipgloss.Color
	iconDim  lipgloss.Color
}

var exitOptions = []exitOption{
	{"◆", "Save and exit", "Keep session for later with an optional description", lipgloss.Color("120"), lipgloss.Color("34")},
	{"✕", "Discard and exit", "Delete this session permanently", lipgloss.Color("208"), lipgloss.Color("130")},
	{"▶", "Resume conversation", "Pick up where Claude left off", lipgloss.Color("75"), lipgloss.Color("25")},
}

var (
	exitTitleStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("252")).
			Bold(true)
	exitSubtitleStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("241"))
	exitActiveLabel = lipgloss.NewStyle().
			Bold(true)
	exitDimLabel = lipgloss.NewStyle().
			Foreground(lipgloss.Color("245"))
	exitDescStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			Italic(true)
	exitInputStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("252"))
	exitCursorStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("120")).
			Bold(true)
	exitBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("236")).
			Padding(1, 2)
	exitInputBoxStyle = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(lipgloss.Color("120")).
				Padding(1, 2)
)

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
	b.WriteString("\n\n")

	if m.editing {
		b.WriteString(m.viewEditing())
	} else {
		b.WriteString(m.viewMenu())
	}

	b.WriteString("\n")
	return b.String()
}

func (m ExitModel) viewMenu() string {
	var content strings.Builder

	// Header
	content.WriteString(exitTitleStyle.Render(fmt.Sprintf("Session %s has ended", m.name)))
	content.WriteString("\n")
	content.WriteString(exitSubtitleStyle.Render("What would you like to do?"))
	content.WriteString("\n\n")

	// Options
	for i, opt := range exitOptions {
		isActive := i == m.cursor

		var line strings.Builder
		if isActive {
			icon := lipgloss.NewStyle().Foreground(opt.accent).Bold(true).Render(opt.icon)
			label := exitActiveLabel.Foreground(opt.accent).Render(opt.label)
			line.WriteString(fmt.Sprintf(" %s  %s", icon, label))
			line.WriteString("\n")
			line.WriteString(fmt.Sprintf("      %s", exitDescStyle.Render(opt.desc)))
		} else {
			icon := lipgloss.NewStyle().Foreground(opt.iconDim).Render(opt.icon)
			label := exitDimLabel.Render(opt.label)
			line.WriteString(fmt.Sprintf(" %s  %s", icon, label))
		}
		content.WriteString(line.String())
		if i < len(exitOptions)-1 {
			content.WriteString("\n")
		}
	}

	content.WriteString("\n\n")
	content.WriteString(exitSubtitleStyle.Render("↑↓ navigate · enter select · q quit"))

	return exitBoxStyle.Render(content.String())
}

func (m ExitModel) viewEditing() string {
	var content strings.Builder

	// Header with the selected option's icon
	opt := exitOptions[0] // Save option
	icon := lipgloss.NewStyle().Foreground(opt.accent).Bold(true).Render(opt.icon)
	content.WriteString(fmt.Sprintf("%s  %s", icon, exitTitleStyle.Render("Save session")))
	content.WriteString("\n")
	content.WriteString(exitSubtitleStyle.Render("Describe what you accomplished (optional)"))
	content.WriteString("\n\n")

	// Input line
	prompt := exitCursorStyle.Render("❯ ")
	text := exitInputStyle.Render(m.description)
	cursor := lipgloss.NewStyle().Foreground(lipgloss.Color("120")).Render("█")
	content.WriteString(fmt.Sprintf(" %s%s%s", prompt, text, cursor))

	content.WriteString("\n\n")
	content.WriteString(exitSubtitleStyle.Render("enter save · esc go back"))

	return exitInputBoxStyle.Render(content.String())
}
