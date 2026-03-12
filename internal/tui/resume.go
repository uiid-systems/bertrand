package tui

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// ResumeOption represents a Claude conversation that can be resumed.
type ResumeOption struct {
	ClaudeID     string
	StartedAt    time.Time
	LastQuestion string
	EventCount   int
	Duration     time.Duration
}

// ResumeModel lets the user pick a Claude conversation to resume or start fresh.
type ResumeModel struct {
	name      string
	options   []ResumeOption
	cursor    int
	chosen    bool
	quitting  bool
	width int
}

// NewResumeModel creates the resume picker. Options should be ordered oldest→newest.
func NewResumeModel(name string, options []ResumeOption) ResumeModel {
	return ResumeModel{name: name, options: options}
}

// Chosen returns true if the user made a selection.
func (m ResumeModel) Chosen() bool { return m.chosen }

// Quitting returns true if the user quit without choosing.
func (m ResumeModel) Quitting() bool { return m.quitting }

// SelectedClaudeID returns the Claude conversation ID to resume,
// or "" if the user chose "Start fresh".
func (m ResumeModel) SelectedClaudeID() string {
	if !m.chosen {
		return ""
	}
	// cursor 0 = "Start fresh"
	if m.cursor == 0 {
		return ""
	}
	// Display is reversed (newest first), so cursor 1 = options[len-1]
	return m.options[len(m.options)-m.cursor].ClaudeID
}

func (m ResumeModel) Init() tea.Cmd { return nil }

func (m ResumeModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
	case tea.KeyMsg:
		totalItems := len(m.options) + 1 // +1 for "Start fresh"
		switch msg.String() {
		case "ctrl+c", "q", "esc":
			m.quitting = true
			return m, tea.Quit
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < totalItems-1 {
				m.cursor++
			}
		case "enter":
			m.chosen = true
			return m, tea.Quit
		}
	}
	return m, nil
}

func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	if m == 0 {
		return fmt.Sprintf("%dh", h)
	}
	return fmt.Sprintf("%dh%dm", h, m)
}

func (m ResumeModel) View() string {
	if m.quitting || m.chosen {
		return ""
	}

	var b strings.Builder
	b.WriteString("\n\n")
	b.WriteString(fmt.Sprintf("  \033[38;5;252mResuming \033[1m%s\033[0m\n\n", m.name))

	// "Start fresh" option
	if m.cursor == 0 {
		b.WriteString("  \033[38;5;120m▸ Start fresh conversation\033[0m\n")
		b.WriteString("    \033[38;5;241mNew Claude session with session timeline injected\033[0m\n")
	} else {
		b.WriteString("  \033[38;5;252m  Start fresh conversation\033[0m\n")
	}

	if len(m.options) > 0 {
		b.WriteString("\n  \033[38;5;241m──────────────────────────────────\033[0m\n\n")
	}

	// Conversation segments — show newest first for easier access
	for i := len(m.options) - 1; i >= 0; i-- {
		opt := m.options[i]
		listIdx := len(m.options) - i // 1-indexed, reversed
		cursorIdx := listIdx          // position in cursor space (0 = fresh)

		ts := opt.StartedAt.Local().Format("Jan 2 15:04")
		dur := formatDuration(opt.Duration)

		label := opt.LastQuestion
		if label == "" {
			label = "(no questions asked)"
		}
		if len(label) > 50 {
			label = label[:47] + "..."
		}

		if m.cursor == cursorIdx {
			b.WriteString(fmt.Sprintf("  \033[38;5;120m▸ %s\033[0m  \033[38;5;241m%s, %d events\033[0m\n", ts, dur, opt.EventCount))
			b.WriteString(fmt.Sprintf("    \033[38;5;252m%s\033[0m\n", label))
		} else {
			b.WriteString(fmt.Sprintf("  \033[38;5;252m  %s\033[0m  \033[38;5;241m%s, %d events\033[0m\n", ts, dur, opt.EventCount))
		}
	}

	b.WriteString("\n")
	b.WriteString("  \033[38;5;241m↑↓ navigate • enter select • esc quit\033[0m\n")
	return b.String()
}

