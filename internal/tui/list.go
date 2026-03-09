package tui

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/uiid-systems/bertrand/internal/session"
)

var (
	selectedStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("170")).Bold(true)
	dimStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	statusColors  = map[string]lipgloss.Color{
		"working": lipgloss.Color("82"),
		"blocked": lipgloss.Color("214"),
		"done":    lipgloss.Color("241"),
	}
)

type ListModel struct {
	sessions []session.State
	cursor   int
	chosen   string
	quitting bool
}

func NewListModel(sessions []session.State) ListModel {
	return ListModel{sessions: sessions}
}

func (m ListModel) Chosen() string { return m.chosen }

func (m ListModel) Init() tea.Cmd { return nil }

func (m ListModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc", "ctrl+c":
			m.quitting = true
			return m, tea.Quit
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(m.sessions)-1 {
				m.cursor++
			}
		case "enter":
			m.chosen = m.sessions[m.cursor].Session
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m ListModel) View() string {
	if m.quitting {
		return ""
	}
	if len(m.sessions) == 0 {
		return dimStyle.Render("No active sessions.\n")
	}

	s := "Sessions:\n\n"
	for i, sess := range m.sessions {
		cursor := "  "
		name := sess.Session
		if i == m.cursor {
			cursor = "> "
			name = selectedStyle.Render(name)
		}

		statusColor, ok := statusColors[sess.Status]
		if !ok {
			statusColor = lipgloss.Color("241")
		}
		status := lipgloss.NewStyle().Foreground(statusColor).Render(sess.Status)

		summary := dimStyle.Render(sess.Summary)
		s += fmt.Sprintf("%s%s  %s  %s\n", cursor, name, status, summary)
	}
	s += "\n" + dimStyle.Render("↑↓ navigate • enter select • esc quit") + "\n"
	return s
}
