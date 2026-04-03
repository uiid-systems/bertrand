package log

import (
	"fmt"
	"strings"
	"time"
)

// RecapStats holds aggregate stats for the session recap.
type RecapStats struct {
	Events        int
	Conversations int
	Duration      time.Duration
}

// RecapStatsFrom computes recap stats from a SessionDigest.
func RecapStatsFrom(d *SessionDigest) RecapStats {
	return RecapStats{
		Events:        d.EventCount,
		Conversations: d.Conversations,
		Duration:      d.EndedAt.Sub(d.StartedAt),
	}
}

// kindBadge maps link kinds to short colored badges for terminal display.
var kindBadge = map[string]string{
	"pr":      "\033[38;5;78mPR\033[0m",
	"linear":  "\033[38;5;141mLIN\033[0m",
	"notion":  "\033[38;5;111mNOT\033[0m",
	"vercel":  "\033[38;5;78mVCL\033[0m",
	"branch":  "\033[38;5;241mBR\033[0m",
}

// RenderRecap produces a concise ANSI-colored session recap for terminal display.
// summary is the agent-written summary (may be empty).
// links are extracted external references.
// stats are aggregate session stats.
// sessionName is used for the `bertrand log` hint.
func RenderRecap(summary string, links []SessionLink, stats RecapStats, sessionName string) string {
	var b strings.Builder
	b.WriteString("\n")

	// Summary line
	if summary != "" && summary != "Session ended" && summary != "Session archived" {
		b.WriteString(fmt.Sprintf("  \033[38;5;252m%s\033[0m\n", summary))
	}

	// Links section
	if len(links) > 0 {
		b.WriteString("\n")
		for _, link := range links {
			badge := kindBadge[link.Kind]
			if badge == "" {
				badge = link.Kind
			}
			if link.URL != "" {
				b.WriteString(fmt.Sprintf("  %s  \033[38;5;252m%s\033[0m\n       \033[38;5;241m%s\033[0m\n", badge, link.Label, link.URL))
			} else {
				b.WriteString(fmt.Sprintf("  %s  \033[38;5;252m%s\033[0m\n", badge, link.Label))
			}
		}
	}

	// Stats line
	b.WriteString("\n")
	b.WriteString("  \033[38;5;241m")
	var parts []string
	parts = append(parts, fmt.Sprintf("\033[38;5;252m%d\033[38;5;241m events", stats.Events))
	if stats.Conversations > 1 {
		parts = append(parts, fmt.Sprintf("\033[38;5;252m%d\033[38;5;241m conversations", stats.Conversations))
	}
	parts = append(parts, fmt.Sprintf("\033[38;5;252m%s\033[38;5;241m", FormatDuration(stats.Duration)))
	b.WriteString(strings.Join(parts, "  "))
	b.WriteString("\033[0m\n")

	// Hint
	b.WriteString(fmt.Sprintf("  \033[38;5;241mRun \033[38;5;120mbertrand log %s\033[38;5;241m for full timeline\033[0m\n", sessionName))

	return b.String()
}

// SessionRecap reads the event log and renders a recap with the given summary.
// The summary comes from session.ReadSummary() (the hint file Claude writes).
// This is the main entry point called from cmd/root.go at session exit.
func SessionRecap(name, summary string) string {
	d, err := Digest(name)
	if err != nil {
		return ""
	}

	events, err := ReadEvents(name)
	if err != nil {
		return ""
	}

	links := ExtractLinks(events)
	stats := RecapStatsFrom(d)

	return RenderRecap(summary, links, stats, name)
}
