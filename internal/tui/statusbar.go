package tui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/uiid-systems/bertrand/internal/session"
)

// StatusBarData holds the information displayed in the status bar.
// Populate only the fields you have — empty/zero values are omitted.
type StatusBarData struct {
	SessionName  string        // e.g. "bertrand/statusbar"
	Status       string        // "working", "blocked", "done", or ""
	Duration     time.Duration // elapsed time
	EventCount   int           // number of log events
	SiblingCount int           // total sibling sessions
	SiblingInfo  string        // e.g. "2● 1●" (pre-formatted)
}

var (
	sbNameStyle       = lipgloss.NewStyle().Foreground(lipgloss.Color("120")).Bold(true)
	sbStatStyle       = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	sbDivStyle        = lipgloss.NewStyle().Foreground(lipgloss.Color("238"))
	sbDotWorkingStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("78"))
	sbDotBlockedStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("214"))
	sbDotDimStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
)

func statusDotStyle(status string) lipgloss.Style {
	switch status {
	case session.StatusWorking:
		return sbDotWorkingStyle
	case session.StatusBlocked:
		return sbDotBlockedStyle
	default:
		return sbDotDimStyle
	}
}

// StatusBar renders a single-line status bar with a separator below.
// Left side: session name + status. Right side: stats + version.
// Pass width=0 to skip right-alignment (no terminal width known).
func StatusBar(d StatusBarData, width int) string {
	var left, right strings.Builder

	// Left: session name + status dot
	if d.SessionName != "" {
		left.WriteString(sbNameStyle.Render(d.SessionName))
	}
	if d.Status != "" {
		style := statusDotStyle(d.Status)
		left.WriteString("  ")
		left.WriteString(style.Render("● " + d.Status))
	}

	// Right: stats
	var parts []string
	if d.Duration > 0 {
		parts = append(parts, formatStatusDuration(d.Duration))
	}
	if d.EventCount > 0 {
		label := "events"
		if d.EventCount == 1 {
			label = "event"
		}
		parts = append(parts, fmt.Sprintf("%d %s", d.EventCount, label))
	}
	if d.SiblingCount > 0 {
		s := fmt.Sprintf("%d siblings", d.SiblingCount)
		if d.SiblingCount == 1 {
			s = "1 sibling"
		}
		if d.SiblingInfo != "" {
			s += " (" + d.SiblingInfo + ")"
		}
		parts = append(parts, s)
	}
	parts = append(parts, "v"+Version)
	right.WriteString(sbStatStyle.Render(strings.Join(parts, " · ")))

	// Compose the line
	leftStr := "  " + left.String()
	rightStr := right.String() + "  "

	var line string
	leftLen := lipgloss.Width(leftStr)
	rightLen := lipgloss.Width(rightStr)
	if width > 0 && width > leftLen+rightLen+2 {
		gap := width - leftLen - rightLen
		line = leftStr + strings.Repeat(" ", gap) + rightStr
	} else {
		line = leftStr + "  " + rightStr
	}

	// Separator
	sepWidth := width
	if sepWidth <= 0 {
		sepWidth = lipgloss.Width(line)
	}
	sep := sbDivStyle.Render("  " + strings.Repeat("─", max(sepWidth-4, 10)))

	return line + "\n" + sep + "\n"
}

func formatStatusDuration(d time.Duration) string {
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
