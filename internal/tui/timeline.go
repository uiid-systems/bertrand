package tui

import (
	"fmt"
	"os"
	"strings"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"golang.org/x/term"
)

// viewportMaxHeight caps the viewport to this many lines.
const viewportMaxHeight = 14

// TimelineModel wraps a rendered timeline string in a scrollable viewport.
type TimelineModel struct {
	viewport viewport.Model
	name     string
	header   string // pre-rendered header (session info)
	footer   string // pre-rendered footer (stats)
	content  string // timeline body
	ready    bool
	quitting bool
	width    int
}

// NewTimelineModel creates a viewport-based timeline viewer.
// rendered is the full ANSI timeline string — header/footer are extracted automatically.
func NewTimelineModel(name string, rendered string) TimelineModel {
	header, body, footer := splitTimeline(rendered)

	// Detect terminal width upfront for inline rendering
	width := 80
	if w, _, err := term.GetSize(int(os.Stdout.Fd())); err == nil && w > 0 {
		width = w
	}

	m := TimelineModel{
		name:    name,
		header:  header,
		content: body,
		footer:  footer,
		width:   width,
	}

	// Initialize viewport immediately so we don't need WindowSizeMsg
	m.viewport = viewport.New(width, viewportMaxHeight)
	m.viewport.SetContent(body)
	m.ready = true

	return m
}

func (m TimelineModel) Quitting() bool { return m.quitting }

func (m TimelineModel) Init() tea.Cmd {
	return nil
}

func (m TimelineModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.viewport.Width = m.width
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc", "enter", "ctrl+c":
			m.quitting = true
			return m, tea.Quit
		}
	}

	m.viewport, cmd = m.viewport.Update(msg)
	return m, cmd
}

func (m TimelineModel) View() string {
	if !m.ready {
		return "\n  Loading timeline..."
	}

	return fmt.Sprintf("%s\n%s\n%s",
		m.renderHeader(),
		m.viewport.View(),
		m.renderFooter(),
	)
}

var (
	timelineHeaderStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("252")).
				Bold(true).
				PaddingLeft(1)

	timelineMetaStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("241")).
				PaddingLeft(1)

	scrollHintStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			PaddingLeft(1)
)

func (m TimelineModel) renderHeader() string {
	var b strings.Builder
	b.WriteString("\n")

	// Session name (left) + started/duration (right) on same line
	title := timelineHeaderStyle.Render(m.name)

	meta := ""
	if m.header != "" {
		// Parse "Started Jan 2 15:04  Duration 2h30m" — labels gray, values white
		meta = formatHeaderMeta(strings.TrimSpace(stripANSI(m.header)))
	}

	if meta != "" {
		gap := m.width - lipgloss.Width(title) - lipgloss.Width(meta) - 2
		if gap < 2 {
			gap = 2
		}
		b.WriteString(fmt.Sprintf("%s%s%s\n", title, strings.Repeat(" ", gap), meta))
	} else {
		b.WriteString(title)
		b.WriteString("\n")
	}

	// Top border (no blank line between header text and border)
	bw := m.borderWidth()
	b.WriteString(fmt.Sprintf("  \033[38;5;238m╭%s╮\033[0m\n", strings.Repeat("─", bw)))

	return b.String()
}

// formatHeaderMeta renders "Started Jan 2 15:04  Duration 2h30m" with gray labels and white values.
func formatHeaderMeta(raw string) string {
	// Expected format: "Started <date>  Duration <dur>"
	parts := strings.SplitN(raw, "Duration", 2)
	if len(parts) != 2 {
		return timelineMetaStyle.Render(raw)
	}
	started := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(parts[0]), "Started"))
	duration := strings.TrimSpace(parts[1])

	return fmt.Sprintf("\033[38;5;241mStarted \033[38;5;252m%s\033[0m  \033[38;5;241mDuration \033[38;5;252m%s\033[0m",
		started, duration)
}

func (m TimelineModel) renderFooter() string {
	var b strings.Builder

	// Bottom border
	bw := m.borderWidth()
	b.WriteString(fmt.Sprintf("  \033[38;5;238m╰%s╯\033[0m\n", strings.Repeat("─", bw)))

	// Collect stat lines from the original footer (skip the divider)
	var statLines []string
	if m.footer != "" {
		for _, line := range strings.Split(m.footer, "\n") {
			stripped := stripANSI(line)
			if strings.Contains(stripped, "─────") || strings.TrimSpace(stripped) == "" {
				continue
			}
			statLines = append(statLines, strings.TrimSpace(line))
		}
	}

	// Scroll position
	scrollPct := m.viewport.ScrollPercent()
	indicator := "top"
	if scrollPct >= 1.0 {
		indicator = "end"
	} else if scrollPct > 0 {
		indicator = fmt.Sprintf("%.0f%%", scrollPct*100)
	}

	controls := fmt.Sprintf("↑↓ scroll • %s • q quit", indicator)

	// Render stats (left) and controls (right) side by side
	if len(statLines) > 0 {
		for i, stat := range statLines {
			if i == 0 {
				// First stat line gets controls on the right
				gap := m.width - lipgloss.Width(stat) - lipgloss.Width(controls) - 4
				if gap < 2 {
					gap = 2
				}
				b.WriteString(fmt.Sprintf("  %s%s%s\n", stat, strings.Repeat(" ", gap), scrollHintStyle.Render(controls)))
			} else {
				b.WriteString(fmt.Sprintf("  %s\n", stat))
			}
		}
	} else {
		b.WriteString(fmt.Sprintf("  %s\n", scrollHintStyle.Render(controls)))
	}

	b.WriteString("\n")

	return b.String()
}

func (m TimelineModel) borderWidth() int {
	w := m.width - 4 // account for "  ╭" prefix + "╮" suffix
	if w < 40 {
		w = 40
	}
	return w
}

// splitTimeline separates the rendered timeline into header, body, and footer.
// The header is everything up to the first blank line after the "Started..." line.
// The footer starts at the horizontal divider (─────).
func splitTimeline(rendered string) (header, body, footer string) {
	lines := strings.Split(rendered, "\n")
	if len(lines) == 0 {
		return "", "", ""
	}

	// Find the "Started" header line (first line with content)
	headerEnd := 0
	for i, line := range lines {
		stripped := stripANSI(line)
		if strings.HasPrefix(strings.TrimSpace(stripped), "Started") {
			headerEnd = i + 1
			break
		}
	}

	// Find the footer divider
	footerStart := len(lines)
	for i := len(lines) - 1; i >= 0; i-- {
		stripped := stripANSI(lines[i])
		if strings.Contains(stripped, "─────") {
			footerStart = i
			break
		}
	}

	header = strings.Join(lines[:headerEnd], "\n")
	body = strings.Join(lines[headerEnd:footerStart], "\n")
	footer = strings.Join(lines[footerStart:], "\n")

	return header, body, footer
}

// stripANSI removes ANSI escape sequences for length/content checks.
func stripANSI(s string) string {
	var b strings.Builder
	i := 0
	for i < len(s) {
		if s[i] == '\033' {
			// Skip until 'm' (SGR terminator)
			for i < len(s) && s[i] != 'm' {
				i++
			}
			if i < len(s) {
				i++ // skip 'm'
			}
		} else {
			b.WriteByte(s[i])
			i++
		}
	}
	return b.String()
}
