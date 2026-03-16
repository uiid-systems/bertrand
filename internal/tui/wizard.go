package tui

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type wizardStep int

const (
	stepTerminal wizardStep = iota
	stepDone
)

type WizardChoice struct {
	Terminal string
}

type WizardModel struct {
	step     wizardStep
	cursor   int
	choice   WizardChoice
	quitting bool
	showLogo bool
	width    int
}

func NewWizardModel() WizardModel {
	return WizardModel{
		showLogo: true,
	}
}

func NewWizardModelNoLogo() WizardModel {
	return WizardModel{
		showLogo: false,
	}
}

func (m WizardModel) Choice() WizardChoice { return m.choice }
func (m WizardModel) Quitting() bool       { return m.quitting }

var (
	promptStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("120"))
	optionStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("252"))
	cursorStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("114"))
	hintStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
)

var terminals = []string{"Wave", "iTerm2", "Terminal.app"}

func (m WizardModel) Init() tea.Cmd { return nil }

func (m WizardModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			m.quitting = true
			return m, tea.Quit
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(terminals)-1 {
				m.cursor++
			}
		case "enter":
			if m.step == stepTerminal {
				m.choice.Terminal = terminals[m.cursor]
				m.step = stepDone
				return m, tea.Quit
			}
		}
	}
	return m, nil
}

func renderOptions(options []string, cursor int) string {
	s := ""
	for i, o := range options {
		if i == cursor {
			s += fmt.Sprintf("  %s %s\n", cursorStyle.Render("❯"), optionStyle.Bold(true).Render(o))
		} else {
			s += fmt.Sprintf("    %s\n", hintStyle.Render(o))
		}
	}
	return s
}

func (m WizardModel) View() string {
	if m.quitting {
		return ""
	}

	s := ""
	if m.showLogo {
		s = Logo()
	}
	s += "\n"

	if m.step == stepTerminal {
		s += promptStyle.Render("? Select your terminal:") + "\n\n"
		s += renderOptions(terminals, m.cursor)
	}

	s += "\n" + hintStyle.Render("  ↑↓ navigate • enter select • q quit") + "\n"

	return s
}
