package tui

import (
	tea "github.com/charmbracelet/bubbletea"
)

type InitPromptModel struct {
	cursor   int
	accepted bool
	quitting bool
}

func NewInitPromptModel() InitPromptModel {
	return InitPromptModel{}
}

func (m InitPromptModel) Accepted() bool { return m.accepted }
func (m InitPromptModel) Quitting() bool { return m.quitting }

func (m InitPromptModel) Init() tea.Cmd { return nil }

func (m InitPromptModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
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
			if m.cursor < 1 {
				m.cursor++
			}
		case "enter":
			m.accepted = m.cursor == 0
			return m, tea.Quit
		}
	}
	return m, nil
}

var initOptions = []string{"Yes, run setup", "No, exit"}

func (m InitPromptModel) View() string {
	if m.quitting {
		return ""
	}

	s := Logo()
	s += promptStyle.Render("  Bertrand needs to be initialized before first use.") + "\n"
	s += promptStyle.Render("  Run setup now?") + "\n\n"
	s += renderOptions(initOptions, m.cursor)
	s += "\n" + hintStyle.Render("  ↑↓ navigate • enter select • q quit") + "\n"

	return s
}
