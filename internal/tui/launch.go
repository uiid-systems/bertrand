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

type launchStep int

const (
	stepProject launchStep = iota
	stepSession
)

type LaunchModel struct {
	step     launchStep
	project  string
	input    textinput.Model
	sessions []session.State // all sessions (used to derive projects and per-project lists)
	items    []string        // current list items (project names or session names)
	states   []session.State // session states for current step (only used in stepSession)
	mode     launchMode
	cursor   int
	chosen   string
	isResume bool
	quitting bool
	deleted  []string
	width    int
}

func NewLaunchModel(sessions []session.State) LaunchModel {
	ti := newInput("name your project...")

	// Derive unique project names from sessions
	projects := uniqueProjects(sessions)

	var suggestions []string
	suggestions = append(suggestions, projects...)
	if len(suggestions) > 0 {
		ti.ShowSuggestions = true
		ti.SetSuggestions(suggestions)
	}

	return LaunchModel{
		step:     stepProject,
		input:    ti,
		sessions: sessions,
		items:    projects,
	}
}

func newInput(placeholder string) textinput.Model {
	ti := textinput.New()
	ti.Placeholder = placeholder
	ti.Prompt = "  ❯ "
	ti.PromptStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("114")).Bold(true)
	ti.TextStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("252"))
	ti.PlaceholderStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	ti.CharLimit = 60
	ti.Focus()
	return ti
}

func uniqueProjects(sessions []session.State) []string {
	seen := map[string]bool{}
	var projects []string
	for _, s := range sessions {
		p, _, err := session.ParseName(s.Session)
		if err != nil {
			continue
		}
		if !seen[p] {
			seen[p] = true
			projects = append(projects, p)
		}
	}
	return projects
}

func sessionsForProject(sessions []session.State, project string) []session.State {
	var result []session.State
	for _, s := range sessions {
		p, _, err := session.ParseName(s.Session)
		if err != nil {
			continue
		}
		if p == project {
			result = append(result, s)
		}
	}
	return result
}

func (m LaunchModel) Chosen() string   { return m.chosen }
func (m LaunchModel) IsResume() bool    { return m.isResume }
func (m LaunchModel) Quitting() bool    { return m.quitting }
func (m LaunchModel) Deleted() []string { return m.deleted }

func (m LaunchModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m *LaunchModel) transitionToSession(project string) tea.Cmd {
	m.step = stepSession
	m.project = project
	m.mode = modeInput
	m.cursor = 0

	ti := newInput("name this session...")
	m.states = sessionsForProject(m.sessions, project)

	var suggestions []string
	var items []string
	for _, s := range m.states {
		_, sess, _ := session.ParseName(s.Session)
		suggestions = append(suggestions, sess)
		items = append(items, sess)
	}
	if len(suggestions) > 0 {
		ti.ShowSuggestions = true
		ti.SetSuggestions(suggestions)
	}
	m.items = items
	m.input = ti
	return textinput.Blink
}

func (m LaunchModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
	case tea.KeyMsg:
		// Confirm delete mode (session step only)
		if m.mode == modeConfirmDelete {
			switch msg.String() {
			case "enter", "y":
				idx := m.cursor
				if idx < len(m.states) {
					name := m.states[idx].Session
					m.deleted = append(m.deleted, name)
					m.states = append(m.states[:idx], m.states[idx+1:]...)
					m.items = append(m.items[:idx], m.items[idx+1:]...)
					// Also remove from master sessions list
					for i, s := range m.sessions {
						if s.Session == name {
							m.sessions = append(m.sessions[:i], m.sessions[i+1:]...)
							break
						}
					}
					if m.cursor >= len(m.states) && m.cursor > 0 {
						m.cursor--
					}
				}
				if len(m.states) == 0 {
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
		case "ctrl+c":
			m.quitting = true
			return m, tea.Quit

		case "esc":
			if m.step == stepSession {
				// Go back to project step
				m.step = stepProject
				m.mode = modeInput
				m.cursor = 0
				m.project = ""
				ti := newInput("name your project...")
				projects := uniqueProjects(m.sessions)
				if len(projects) > 0 {
					ti.ShowSuggestions = true
					ti.SetSuggestions(projects)
				}
				m.input = ti
				m.items = projects
				m.states = nil
				return m, textinput.Blink
			}
			m.quitting = true
			return m, tea.Quit

		case "d":
			if m.step == stepSession && m.mode == modeList && m.cursor < len(m.states) {
				m.mode = modeConfirmDelete
				return m, nil
			}

		case "enter":
			if m.mode == modeList {
				if m.cursor < len(m.items) {
					if m.step == stepProject {
						// Selected existing project → transition to session step
						cmd := m.transitionToSession(m.items[m.cursor])
						return m, cmd
					}
					// Session step: resume existing session
					m.chosen = m.project + "/" + m.items[m.cursor]
					m.isResume = true
					return m, tea.Quit
				}
				return m, nil
			}
			// Input mode
			name := strings.TrimSpace(m.input.Value())
			if name == "" && len(m.items) > 0 {
				m.mode = modeList
				m.input.Blur()
				return m, nil
			}
			if name != "" {
				if m.step == stepProject {
					// Check if it matches existing project
					for _, p := range m.items {
						if p == name {
							cmd := m.transitionToSession(name)
							return m, cmd
						}
					}
					// New project
					cmd := m.transitionToSession(name)
					return m, cmd
				}
				// Session step: check if it matches existing session
				for _, s := range m.states {
					_, sess, _ := session.ParseName(s.Session)
					if sess == name {
						m.chosen = m.project + "/" + name
						m.isResume = true
						return m, tea.Quit
					}
				}
				m.chosen = m.project + "/" + name
				m.isResume = false
				return m, tea.Quit
			}
			return m, nil

		case "down":
			if m.mode == modeInput && m.input.Value() == "" && len(m.items) > 0 {
				m.mode = modeList
				m.input.Blur()
				return m, nil
			}
			if m.mode == modeList && m.cursor < len(m.items)-1 {
				m.cursor++
			}
			return m, nil

		case "up":
			if m.mode == modeList {
				if m.cursor > 0 {
					m.cursor--
				} else {
					m.mode = modeInput
					m.input.Focus()
					return m, textinput.Blink
				}
			}
			return m, nil

		case "tab":
			if m.mode == modeInput && len(m.items) > 0 {
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
	sessionNameActive    = lipgloss.NewStyle().Foreground(lipgloss.Color("120")).Bold(true)
	sessionDimStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("252"))
	sessionSummaryActive = lipgloss.NewStyle().Foreground(lipgloss.Color("252"))
	sessionSummaryDim    = lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Italic(true)
	statusWorkingStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("78"))
	statusBlockedStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("214"))
	statusDoneStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	dividerStyle         = lipgloss.NewStyle().Foreground(lipgloss.Color("238"))
	dangerStyle          = lipgloss.NewStyle().Foreground(lipgloss.Color("196")).Bold(true)
	dangerDimStyle       = lipgloss.NewStyle().Foreground(lipgloss.Color("124"))
	projectLabelStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("114")).Bold(true)
)

func (m LaunchModel) View() string {
	if m.quitting {
		return ""
	}

	var b strings.Builder
	b.WriteString(Logo())
	sb := StatusBarData{}
	if m.step == stepSession {
		sb.SessionName = m.project
	}
	b.WriteString(StatusBar(sb, m.width))

	if m.step == stepSession {
		b.WriteString(fmt.Sprintf("  %s\n", projectLabelStyle.Render(m.project+"/")))
	}

	b.WriteString(m.input.View())
	b.WriteString("\n")

	if m.step == stepProject {
		m.renderProjectList(&b)
	} else {
		m.renderSessionList(&b)
	}

	b.WriteString("\n")
	b.WriteString(hintStyle.Render(m.hints()))
	b.WriteString("\n")

	return b.String()
}

func (m LaunchModel) renderProjectList(b *strings.Builder) {
	if len(m.items) == 0 {
		return
	}
	b.WriteString("\n")
	b.WriteString(dividerStyle.Render("  ─── projects ───"))
	b.WriteString("\n\n")

	for i, name := range m.items {
		isSelected := m.mode == modeList && i == m.cursor
		prefix := "    "
		style := sessionDimStyle
		if isSelected {
			prefix = "  ❯ "
			style = sessionNameActive
		}

		count := len(sessionsForProject(m.sessions, name))
		countStr := fmt.Sprintf("%d sessions", count)
		if count == 1 {
			countStr = "1 session"
		}

		b.WriteString(fmt.Sprintf("%s%s  %s\n", prefix, style.Render(name), sessionSummaryDim.Render(countStr)))
	}
}

func (m LaunchModel) renderSessionList(b *strings.Builder) {
	if len(m.states) == 0 {
		return
	}
	b.WriteString("\n")
	b.WriteString(dividerStyle.Render("  ─── sessions ───"))
	b.WriteString("\n\n")

	for i, s := range m.states {
		_, sessName, _ := session.ParseName(s.Session)
		isSelected := m.mode == modeList && i == m.cursor
		isDeleting := m.mode == modeConfirmDelete && i == m.cursor

		if isDeleting {
			b.WriteString(fmt.Sprintf("  %s %s  %s\n",
				dangerStyle.Render("✕"),
				dangerStyle.Render(sessName),
				dangerDimStyle.Render("delete? enter to confirm · any key to cancel"),
			))
			continue
		}

		prefix := "    "
		nameStyle := sessionDimStyle
		if isSelected {
			prefix = "  ❯ "
			nameStyle = sessionNameActive
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

		b.WriteString(fmt.Sprintf("%s%s  %s\n", prefix, nameStyle.Render(sessName), status))

		hasSummary := s.Summary != "" && s.Summary != "Session ended" && s.Summary != "Session started"
		if hasSummary {
			summStyle := sessionSummaryDim
			if isSelected {
				summStyle = sessionSummaryActive
			}
			b.WriteString(fmt.Sprintf("        %s\n", summStyle.Render(s.Summary)))
		}
	}
}

func (m LaunchModel) hints() string {
	if m.step == stepProject {
		if len(m.items) > 0 {
			return "  enter select · ↑↓ browse · tab switch"
		}
		return "  enter create project"
	}
	hints := "  enter start · esc back"
	if len(m.states) > 0 {
		hints = "  enter start · ↑↓ browse · tab switch · d delete · esc back"
	}
	return hints
}
