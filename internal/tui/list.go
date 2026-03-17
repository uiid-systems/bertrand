package tui

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/uiid-systems/bertrand/internal/session"
)

var (
	selectedStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("120")).Bold(true)
	dimStyle         = lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	summaryDimStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Italic(true)
	summarySelStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("252"))
	statusColors = map[string]lipgloss.Color{
		session.StatusWorking:   lipgloss.Color("82"),
		session.StatusBlocked:   lipgloss.Color("214"),
		session.StatusPrompting: lipgloss.Color("81"),
		session.StatusPaused:    lipgloss.Color("241"),
		session.StatusArchived:  lipgloss.Color("239"),
	}
)

type ListModel struct {
	sessions []session.State
	cursor   int
	chosen   string
	quitting bool
	width    int
}

func NewListModel(sessions []session.State) ListModel {
	return ListModel{sessions: sessions}
}

func (m ListModel) Chosen() string { return m.chosen }

func (m ListModel) Init() tea.Cmd { return nil }

func (m ListModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
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

	s := "\nSessions:\n\n"
	for i, sess := range m.sessions {
		isSelected := i == m.cursor

		prefix := "    "
		nameStyle := dimStyle
		if isSelected {
			prefix = "  ❯ "
			nameStyle = selectedStyle
		}

		statusColor, ok := statusColors[sess.Status]
		if !ok {
			statusColor = lipgloss.Color("241")
		}
		status := lipgloss.NewStyle().Foreground(statusColor).Render(sess.Status)

		s += fmt.Sprintf("%s%s  %s\n", prefix, nameStyle.Render(sess.Session), status)

		hasSummary := sess.Summary != "" && sess.Summary != "Session ended" && sess.Summary != "Session started"
		if hasSummary {
			summStyle := summaryDimStyle
			if isSelected {
				summStyle = summarySelStyle
			}
			s += fmt.Sprintf("        %s\n", summStyle.Render(sess.Summary))
		}
	}
	s += "\n" + dimStyle.Render("↑↓ navigate • enter select • esc quit") + "\n"
	return s
}
