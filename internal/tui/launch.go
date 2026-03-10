package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/uiid-systems/bertrand/internal/session"
)

type launchMode int

const (
	modeInput launchMode = iota
	modeList
	modeConfirmDelete
)

type LaunchModel struct {
	input    textinput.Model
	sessions []session.State
	mode     launchMode
	cursor   int
	chosen   string
	isResume bool
	quitting bool
	deleted  []string // track deleted session names for cleanup
}

func NewLaunchModel(sessions []session.State) LaunchModel {
	ti := textinput.New()
	ti.Placeholder = "name your session..."
	ti.Prompt = "  ❯ "
	ti.PromptStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("114")).Bold(true)
	ti.TextStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("252"))
	ti.PlaceholderStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	ti.CharLimit = 60
	ti.Focus()

	// Build suggestions from existing session names
	var suggestions []string
	for _, s := range sessions {
		suggestions = append(suggestions, s.Session)
	}
	if len(suggestions) > 0 {
		ti.ShowSuggestions = true
		ti.SetSuggestions(suggestions)
	}

	return LaunchModel{
		input:    ti,
		sessions: sessions,
	}
}

func (m LaunchModel) Chosen() string   { return m.chosen }
func (m LaunchModel) IsResume() bool    { return m.isResume }
func (m LaunchModel) Quitting() bool    { return m.quitting }
func (m LaunchModel) Deleted() []string { return m.deleted }

func (m LaunchModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m LaunchModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		// Confirm delete mode
		if m.mode == modeConfirmDelete {
			switch msg.String() {
			case "enter", "y":
				// Delete the session
				name := m.sessions[m.cursor].Session
				m.deleted = append(m.deleted, name)
				m.sessions = append(m.sessions[:m.cursor], m.sessions[m.cursor+1:]...)
				if m.cursor >= len(m.sessions) && m.cursor > 0 {
					m.cursor--
				}
				if len(m.sessions) == 0 {
					m.mode = modeInput
					m.input.Focus()
					return m, textinput.Blink
				}
				m.mode = modeList
			default:
				m.mode = modeList
			}
			return m, nil
		}

		switch msg.String() {
		case "ctrl+c", "esc":
			m.quitting = true
			return m, tea.Quit

		case "d":
			if m.mode == modeList && m.cursor < len(m.sessions) {
				m.mode = modeConfirmDelete
				return m, nil
			}

		case "enter":
			if m.mode == modeList {
				if m.cursor < len(m.sessions) {
					m.chosen = m.sessions[m.cursor].Session
					m.isResume = true
				}
				return m, tea.Quit
			}
			// Input mode
			name := strings.TrimSpace(m.input.Value())
			if name == "" && len(m.sessions) > 0 {
				// Empty enter with sessions available → switch to list
				m.mode = modeList
				m.input.Blur()
				return m, nil
			}
			if name != "" {
				// Check if it matches an existing session
				for _, s := range m.sessions {
					if s.Session == name {
						m.chosen = name
						m.isResume = true
						return m, tea.Quit
					}
				}
				m.chosen = name
				m.isResume = false
				return m, tea.Quit
			}
			return m, nil

		case "down":
			if m.mode == modeInput && m.input.Value() == "" && len(m.sessions) > 0 {
				m.mode = modeList
				m.input.Blur()
				return m, nil
			}
			if m.mode == modeList && m.cursor < len(m.sessions)-1 {
				m.cursor++
			}
			return m, nil

		case "up":
			if m.mode == modeList {
				if m.cursor > 0 {
					m.cursor--
				} else {
					// Back to input
					m.mode = modeInput
					m.input.Focus()
					return m, textinput.Blink
				}
			}
			return m, nil

		case "tab":
			if m.mode == modeInput && len(m.sessions) > 0 {
				m.mode = modeList
				m.input.Blur()
				return m, nil
			}
			if m.mode == modeList {
				m.mode = modeInput
				m.input.Focus()
				return m, textinput.Blink
			}
			return m, nil
		}
	}

	if m.mode == modeInput {
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(msg)
		// Auto-replace spaces with dashes (Discord-style)
		val := m.input.Value()
		if strings.Contains(val, " ") {
			m.input.SetValue(strings.ReplaceAll(val, " ", "-"))
			m.input.SetCursor(len(m.input.Value()))
		}
		return m, cmd
	}
	return m, nil
}

var (
	sessionNameStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("252")).Bold(true)
	sessionDimStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	sessionActiveStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("114")).Bold(true)
	statusWorkingStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("78"))
	statusBlockedStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("214"))
	statusDoneStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	dividerStyle       = lipgloss.NewStyle().Foreground(lipgloss.Color("236"))
	dangerStyle        = lipgloss.NewStyle().Foreground(lipgloss.Color("196")).Bold(true)
	dangerDimStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("124"))
)

func (m LaunchModel) View() string {
	if m.quitting {
		return ""
	}

	var b strings.Builder

	b.WriteString(Logo())
	b.WriteString(m.input.View())
	b.WriteString("\n")

	if len(m.sessions) > 0 {
		b.WriteString("\n")
		b.WriteString(dividerStyle.Render("  ─── recent sessions ───"))
		b.WriteString("\n\n")

		for i, s := range m.sessions {
			prefix := "    "
			nameStyle := sessionDimStyle
			isSelected := m.mode == modeList && i == m.cursor
			isDeleting := m.mode == modeConfirmDelete && i == m.cursor

			if isDeleting {
				b.WriteString(fmt.Sprintf("  %s %s  %s\n",
					dangerStyle.Render("✕"),
					dangerStyle.Render(s.Session),
					dangerDimStyle.Render("delete? enter to confirm · any key to cancel"),
				))
				continue
			}

			if isSelected {
				prefix = sessionActiveStyle.Render("  ❯ ")
				nameStyle = sessionNameStyle
			}

			var status string
			switch s.Status {
			case session.StatusWorking:
				status = statusWorkingStyle.Render("● working")
			case session.StatusBlocked:
				status = statusBlockedStyle.Render("● blocked")
			case session.StatusDone:
				status = statusDoneStyle.Render("● done")
			}

			summary := sessionDimStyle.Render(s.Summary)
			b.WriteString(fmt.Sprintf("%s%s  %s  %s\n", prefix, nameStyle.Render(s.Session), status, summary))
		}
	}

	b.WriteString("\n")
	hints := "  enter start"
	if len(m.sessions) > 0 {
		hints = "  enter start · ↑↓ browse · tab switch · d delete"
	}
	b.WriteString(hintStyle.Render(hints))
	b.WriteString("\n")

	return b.String()
}
