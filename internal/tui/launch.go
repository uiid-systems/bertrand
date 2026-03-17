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
	stepSession // shows ticket groups + direct sessions within a project
	stepTicket  // shows sessions within a ticket group
)

// listItem represents an entry in step 2 that can be either a ticket group or a direct session.
type listItem struct {
	name     string // display name
	isTicket bool   // true = ticket group (navigate deeper), false = session (resume/launch)
	count    int    // session count (for ticket groups)
}

type LaunchModel struct {
	step      launchStep
	project   string
	ticket    string
	input     textinput.Model
	sessions  []session.State // all sessions (used to derive projects and per-project lists)
	items     []string        // current list items (project names, ticket/session names, or session names)
	listItems []listItem      // enriched items for stepSession (ticket groups + direct sessions)
	states    []session.State // session states for current step (stepSession direct sessions or stepTicket sessions)
	mode      launchMode
	cursor    int
	chosen    string
	isResume  bool
	quitting  bool
	deleted   []string
	width     int
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
		p, _, _, err := session.ParseName(s.Session)
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
		p, _, _, err := session.ParseName(s.Session)
		if err != nil {
			continue
		}
		if p == project {
			result = append(result, s)
		}
	}
	return result
}

// projectEntries derives ticket groups and direct sessions for a project.
// Ticket groups are identified by sessions with a non-empty ticket part.
func projectEntries(sessions []session.State, project string) (tickets []listItem, directSessions []session.State) {
	ticketMap := map[string]int{}      // ticket name → session count
	var ticketOrder []string           // preserve order
	for _, s := range sessions {
		p, t, _, err := session.ParseName(s.Session)
		if err != nil || p != project {
			continue
		}
		if t != "" {
			if _, seen := ticketMap[t]; !seen {
				ticketOrder = append(ticketOrder, t)
			}
			ticketMap[t]++
		} else {
			directSessions = append(directSessions, s)
		}
	}
	for _, t := range ticketOrder {
		tickets = append(tickets, listItem{name: t, isTicket: true, count: ticketMap[t]})
	}
	return tickets, directSessions
}

// sessionsForTicket returns sessions within a specific project/ticket group.
func sessionsForTicket(sessions []session.State, project, ticket string) []session.State {
	var result []session.State
	for _, s := range sessions {
		p, t, _, err := session.ParseName(s.Session)
		if err != nil {
			continue
		}
		if p == project && t == ticket {
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
	m.ticket = ""
	m.mode = modeInput
	m.cursor = 0

	ti := newInput("name this session...")

	tickets, directSessions := projectEntries(m.sessions, project)
	m.states = directSessions

	// Build the mixed list: ticket groups first, then direct sessions
	var allItems []listItem
	allItems = append(allItems, tickets...)
	for _, s := range directSessions {
		_, _, sess, _ := session.ParseName(s.Session)
		allItems = append(allItems, listItem{name: sess, isTicket: false})
	}
	m.listItems = allItems

	// Build flat items list and suggestions
	var items []string
	var suggestions []string
	for _, item := range allItems {
		items = append(items, item.name)
		suggestions = append(suggestions, item.name)
	}
	if len(suggestions) > 0 {
		ti.ShowSuggestions = true
		ti.SetSuggestions(suggestions)
	}
	m.items = items
	m.input = ti
	return textinput.Blink
}

func (m *LaunchModel) transitionToTicket(project, ticket string) tea.Cmd {
	m.step = stepTicket
	m.project = project
	m.ticket = ticket
	m.mode = modeInput
	m.cursor = 0

	ti := newInput("name this session...")

	m.states = sessionsForTicket(m.sessions, project, ticket)
	m.listItems = nil // not used in stepTicket

	var items []string
	var suggestions []string
	for _, s := range m.states {
		_, _, sess, _ := session.ParseName(s.Session)
		items = append(items, sess)
		suggestions = append(suggestions, sess)
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
		// Confirm delete mode
		if m.mode == modeConfirmDelete {
			switch msg.String() {
			case "enter", "y":
				if m.step == stepSession {
					// In stepSession, delete uses the listItems mapping to find the session
					idx := m.cursor
					if idx < len(m.listItems) && !m.listItems[idx].isTicket {
						fullName := m.project + "/" + m.listItems[idx].name
						m.deleted = append(m.deleted, fullName)
						m.listItems = append(m.listItems[:idx], m.listItems[idx+1:]...)
						m.items = append(m.items[:idx], m.items[idx+1:]...)
						// Remove from states and master sessions
						for i, s := range m.states {
							if s.Session == fullName {
								m.states = append(m.states[:i], m.states[i+1:]...)
								break
							}
						}
						for i, s := range m.sessions {
							if s.Session == fullName {
								m.sessions = append(m.sessions[:i], m.sessions[i+1:]...)
								break
							}
						}
					}
				} else if m.step == stepTicket {
					idx := m.cursor
					if idx < len(m.states) {
						name := m.states[idx].Session
						m.deleted = append(m.deleted, name)
						m.states = append(m.states[:idx], m.states[idx+1:]...)
						m.items = append(m.items[:idx], m.items[idx+1:]...)
						for i, s := range m.sessions {
							if s.Session == name {
								m.sessions = append(m.sessions[:i], m.sessions[i+1:]...)
								break
							}
						}
					}
				}
				if m.cursor >= len(m.items) && m.cursor > 0 {
					m.cursor--
				}
				if len(m.items) == 0 {
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
			switch m.step {
			case stepTicket:
				// Go back to session step
				cmd := m.transitionToSession(m.project)
				return m, cmd
			case stepSession:
				// Go back to project step
				m.step = stepProject
				m.mode = modeInput
				m.cursor = 0
				m.project = ""
				m.ticket = ""
				ti := newInput("name your project...")
				projects := uniqueProjects(m.sessions)
				if len(projects) > 0 {
					ti.ShowSuggestions = true
					ti.SetSuggestions(projects)
				}
				m.input = ti
				m.items = projects
				m.states = nil
				m.listItems = nil
				return m, textinput.Blink
			default:
				m.quitting = true
				return m, tea.Quit
			}

		case "d":
			if m.mode == modeList {
				if m.step == stepSession && m.cursor < len(m.listItems) && !m.listItems[m.cursor].isTicket {
					m.mode = modeConfirmDelete
					return m, nil
				}
				if m.step == stepTicket && m.cursor < len(m.states) {
					m.mode = modeConfirmDelete
					return m, nil
				}
			}

		case "enter":
			if m.mode == modeList {
				if m.cursor < len(m.items) {
					switch m.step {
					case stepProject:
						cmd := m.transitionToSession(m.items[m.cursor])
						return m, cmd
					case stepSession:
						item := m.listItems[m.cursor]
						if item.isTicket {
							// Navigate into ticket group
							cmd := m.transitionToTicket(m.project, item.name)
							return m, cmd
						}
						// Direct session: resume
						m.chosen = m.project + "/" + item.name
						m.isResume = true
						return m, tea.Quit
					case stepTicket:
						// Resume session within ticket
						m.chosen = m.project + "/" + m.ticket + "/" + m.items[m.cursor]
						m.isResume = true
						return m, tea.Quit
					}
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
				switch m.step {
				case stepProject:
					cmd := m.transitionToSession(name)
					return m, cmd
				case stepSession:
					// Slash detection: "ticket/" → navigate to ticket step
					// "ticket/session" → create 3-level session directly
					// "session" → create 2-level session
					if strings.Contains(name, "/") {
						parts := strings.SplitN(name, "/", 2)
						ticket := parts[0]
						sess := parts[1]
						if sess == "" {
							// Trailing slash → navigate to ticket group
							cmd := m.transitionToTicket(m.project, ticket)
							return m, cmd
						}
						// Full ticket/session → create 3-level session
						fullName := m.project + "/" + ticket + "/" + sess
						for _, s := range m.sessions {
							if s.Session == fullName {
								m.chosen = fullName
								m.isResume = true
								return m, tea.Quit
							}
						}
						m.chosen = fullName
						m.isResume = false
						return m, tea.Quit
					}
					// No slash: check if it matches existing session
					for _, s := range m.states {
						_, _, sess, _ := session.ParseName(s.Session)
						if sess == name {
							m.chosen = m.project + "/" + name
							m.isResume = true
							return m, tea.Quit
						}
					}
					// Check if it matches an existing ticket group
					for _, item := range m.listItems {
						if item.isTicket && item.name == name {
							cmd := m.transitionToTicket(m.project, name)
							return m, cmd
						}
					}
					// New 2-level session
					m.chosen = m.project + "/" + name
					m.isResume = false
					return m, tea.Quit
				case stepTicket:
					// Check if it matches existing session in ticket
					for _, s := range m.states {
						_, _, sess, _ := session.ParseName(s.Session)
						if sess == name {
							m.chosen = m.project + "/" + m.ticket + "/" + name
							m.isResume = true
							return m, tea.Quit
						}
					}
					// New session in ticket
					m.chosen = m.project + "/" + m.ticket + "/" + name
					m.isResume = false
					return m, tea.Quit
				}
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
	b.WriteString("\n")

	switch m.step {
	case stepSession:
		b.WriteString(fmt.Sprintf("  %s\n", projectLabelStyle.Render(m.project+"/")))
	case stepTicket:
		b.WriteString(fmt.Sprintf("  %s\n", projectLabelStyle.Render(m.project+"/"+m.ticket+"/")))
	}

	b.WriteString(m.input.View())
	b.WriteString("\n")

	switch m.step {
	case stepProject:
		m.renderProjectList(&b)
	case stepSession:
		m.renderMixedList(&b)
	case stepTicket:
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

// renderMixedList renders the step 2 view: ticket groups + direct sessions.
func (m LaunchModel) renderMixedList(b *strings.Builder) {
	if len(m.listItems) == 0 {
		return
	}

	inTicketSection := false
	inSessionSection := false
	for i, item := range m.listItems {
		isSelected := m.mode == modeList && i == m.cursor
		isDeleting := m.mode == modeConfirmDelete && i == m.cursor

		if item.isTicket && !inTicketSection {
			inTicketSection = true
			b.WriteString("\n")
			b.WriteString(dividerStyle.Render("  ─── tickets ───"))
			b.WriteString("\n\n")
		}
		if !item.isTicket && !inSessionSection {
			inSessionSection = true
			b.WriteString("\n")
			b.WriteString(dividerStyle.Render("  ─── sessions ───"))
			b.WriteString("\n\n")
		}

		if item.isTicket {
			prefix := "    "
			style := sessionDimStyle
			if isSelected {
				prefix = "  ❯ "
				style = sessionNameActive
			}
			countStr := fmt.Sprintf("%d sessions", item.count)
			if item.count == 1 {
				countStr = "1 session"
			}
			b.WriteString(fmt.Sprintf("%s%s  %s\n", prefix, style.Render(item.name), sessionSummaryDim.Render(countStr)))
		} else {
			// Find the matching state for this direct session
			var state *session.State
			for _, s := range m.states {
				_, _, sess, _ := session.ParseName(s.Session)
				if sess == item.name {
					state = &s
					break
				}
			}

			if isDeleting {
				b.WriteString(fmt.Sprintf("  %s %s  %s\n",
					dangerStyle.Render("✕"),
					dangerStyle.Render(item.name),
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
			if state != nil {
				switch state.Status {
				case session.StatusWorking:
					status = statusWorkingStyle.Render("● working")
				case session.StatusBlocked:
					status = statusBlockedStyle.Render("● blocked")
				case session.StatusDone:
					status = statusDoneStyle.Render("● done")
				}
			}

			b.WriteString(fmt.Sprintf("%s%s  %s\n", prefix, nameStyle.Render(item.name), status))

			if state != nil {
				hasSummary := state.Summary != "" && state.Summary != "Session ended" && state.Summary != "Session started"
				if hasSummary {
					summStyle := sessionSummaryDim
					if isSelected {
						summStyle = sessionSummaryActive
					}
					b.WriteString(fmt.Sprintf("        %s\n", summStyle.Render(state.Summary)))
				}
			}
		}
	}

}

// renderSessionList renders sessions for stepTicket (sessions within a ticket group).
func (m LaunchModel) renderSessionList(b *strings.Builder) {
	if len(m.states) == 0 {
		return
	}
	b.WriteString("\n")
	b.WriteString(dividerStyle.Render("  ─── sessions ───"))
	b.WriteString("\n\n")

	for i, s := range m.states {
		_, _, sessName, _ := session.ParseName(s.Session)
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
	switch m.step {
	case stepProject:
		if len(m.items) > 0 {
			return "  enter select · ↑↓ browse · tab switch"
		}
		return "  enter create project"
	case stepSession:
		if len(m.listItems) > 0 {
			return "  enter select · ↑↓ browse · tab switch · d delete · esc back"
		}
		return "  enter start · esc back"
	case stepTicket:
		if len(m.states) > 0 {
			return "  enter start · ↑↓ browse · tab switch · d delete · esc back"
		}
		return "  enter start · esc back"
	}
	return ""
}
