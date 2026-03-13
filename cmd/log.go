package cmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/schema"
	"github.com/uiid-systems/bertrand/internal/session"
)

var jsonOutput bool

var logCmd = &cobra.Command{
	Use:   "log [session]",
	Short: "Show session activity logs",
	Long:  "Without arguments, shows a summary of all sessions. With a session name, shows the full timeline.",
	RunE:  runLog,
}

func init() {
	logCmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON lines")
	rootCmd.AddCommand(logCmd)
}

// unifiedEntry normalizes all log formats into a display-ready structure.
type unifiedEntry struct {
	Event   string
	Session string
	TS      time.Time
	Summary string
}

func readTypedLog(name string) ([]*schema.TypedEvent, error) {
	path := filepath.Join(session.SessionDir(name), "log.jsonl")
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var events []*schema.TypedEvent
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		te, err := schema.ParseEvent(scanner.Bytes())
		if err != nil {
			continue
		}
		events = append(events, te)
	}
	return events, scanner.Err()
}

func readUnifiedLog(name string) ([]unifiedEntry, error) {
	events, err := readTypedLog(name)
	if err != nil {
		return nil, err
	}
	var entries []unifiedEntry
	for _, te := range events {
		entries = append(entries, unifiedEntry{
			Event:   te.Event,
			Session: te.Session,
			TS:      te.TS,
			Summary: te.MetaSummary(),
		})
	}
	return entries, nil
}

func runLog(cmd *cobra.Command, args []string) error {
	if len(args) > 0 {
		return showSessionLog(args[0])
	}
	return showAllSessions()
}

func showAllSessions() error {
	allSessions, err := session.ListSessions()
	if err != nil {
		fmt.Println("No sessions found.")
		return nil
	}

	type sessionSummary struct {
		name         string
		status       string
		events       int
		interactions int
		duration     time.Duration
		lastActivity time.Time
		lastSummary  string
	}

	var summaries []sessionSummary

	for _, s := range allSessions {
		log, err := readUnifiedLog(s.Session)
		if err != nil || len(log) == 0 {
			continue
		}

		interactions := 0
		for _, entry := range log {
			if entry.Event == "session.block" || entry.Event == "state.blocked" {
				interactions++
			}
		}

		first := log[0].TS
		last := log[len(log)-1].TS

		summaries = append(summaries, sessionSummary{
			name:         s.Session,
			status:       s.Status,
			events:       len(log),
			interactions: interactions,
			duration:     last.Sub(first),
			lastActivity: last,
			lastSummary:  log[len(log)-1].Summary,
		})
	}

	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].lastActivity.After(summaries[j].lastActivity)
	})

	if len(summaries) == 0 {
		fmt.Println("No sessions found.")
		return nil
	}

	if jsonOutput {
		for _, s := range summaries {
			data, _ := json.Marshal(map[string]interface{}{
				"session":      s.name,
				"status":       s.status,
				"events":       s.events,
				"interactions": s.interactions,
				"duration_s":   int(s.duration.Seconds()),
				"last_activity": s.lastActivity,
			})
			fmt.Println(string(data))
		}
		return nil
	}

	for _, s := range summaries {
		statusIcon := "●"
		switch s.status {
		case "working":
			statusIcon = "\033[32m●\033[0m"
		case "blocked":
			statusIcon = "\033[33m●\033[0m"
		case "done":
			statusIcon = "\033[90m●\033[0m"
		}

		dur := formatDuration(s.duration)
		ago := formatAgo(s.lastActivity)

		fmt.Printf("%s %-28s %s  %d events  %d interactions  %s ago\n",
			statusIcon, s.name, dur, s.events, s.interactions, ago)
	}

	return nil
}

func showSessionLog(name string) error {
	typedEvents, err := readTypedLog(name)
	if err != nil {
		return fmt.Errorf("session %q: %w", name, err)
	}

	if len(typedEvents) == 0 {
		fmt.Printf("No log entries for %s.\n", name)
		return nil
	}

	// Convert to unified entries for display
	var log []unifiedEntry
	for _, te := range typedEvents {
		log = append(log, unifiedEntry{
			Event:   te.Event,
			Session: te.Session,
			TS:      te.TS,
			Summary: te.MetaSummary(),
		})
	}

	if jsonOutput {
		timing := schema.ComputeTimings(typedEvents)
		for _, entry := range log {
			data, _ := json.Marshal(map[string]interface{}{
				"event":   entry.Event,
				"session": entry.Session,
				"ts":      entry.TS,
				"summary": entry.Summary,
			})
			fmt.Println(string(data))
		}
		// Append timing summary as final JSON line
		data, _ := json.Marshal(map[string]interface{}{
			"_type":            "timing_summary",
			"total_claude_work_s": int(timing.TotalClaudeWork.Seconds()),
			"total_user_wait_s":  int(timing.TotalUserWait.Seconds()),
			"segments":           len(timing.Segments),
		})
		fmt.Println(string(data))
		return nil
	}

	timing := schema.ComputeTimings(typedEvents)
	fmt.Printf("\033[1m%s\033[0m\n", name)
	fmt.Print(renderTimeline(log, timing))
	return nil
}

// renderTimeline formats log entries as a vertical pipe timeline.
// Used by both `bertrand log <session>` and the exit screen.
// timing is optional — pass nil to skip timing display in footer.
func renderTimeline(entries []unifiedEntry, timing *schema.TimingSummary) string {
	if len(entries) == 0 {
		return ""
	}

	var b strings.Builder
	first := entries[0].TS
	last := entries[len(entries)-1].TS

	b.WriteString(fmt.Sprintf("\033[38;5;241mStarted %s  Duration %s\033[0m\n\n",
		first.Local().Format("Jan 2 15:04"), formatDuration(last.Sub(first))))

	for i, entry := range entries {
		isFirst := i == 0
		isLast := i == len(entries)-1

		// Connector character
		var connector string
		if isFirst {
			connector = "┌"
		} else if isLast {
			connector = "└"
		} else {
			connector = "├"
		}

		// Color the connector based on event type
		connectorColor := eventConnectorColor(entry.Event)
		coloredConnector := fmt.Sprintf("\033[38;5;%dm%s\033[0m", connectorColor, connector)

		ts := entry.TS.Local().Format("15:04")
		label := eventLabel(entry.Event)

		// Build the detail text
		detail := ""
		if entry.Summary != "" {
			detail = entry.Summary
			if len(detail) > 60 {
				detail = detail[:57] + "..."
			}
			detail = strings.ReplaceAll(detail, "\n", " ")
		}

		// Gap indicator
		gap := ""
		if i > 0 {
			d := entry.TS.Sub(entries[i-1].TS)
			if d > 5*time.Second {
				gap = fmt.Sprintf(" \033[38;5;241m+%s\033[0m", formatDuration(d))
			}
		}

		// Format: "  HH:MM  ├ label  detail  +gap"
		if detail != "" {
			b.WriteString(fmt.Sprintf("  \033[38;5;241m%s\033[0m  %s \033[38;5;252m%s\033[0m  \033[38;5;%dm%s\033[0m%s\n",
				ts, coloredConnector, label, eventDetailColor(entry.Event), detail, gap))
		} else {
			b.WriteString(fmt.Sprintf("  \033[38;5;241m%s\033[0m  %s \033[38;5;252m%s\033[0m%s\n",
				ts, coloredConnector, label, gap))
		}

		// Draw a pipe between entries (except after last)
		if !isLast {
			b.WriteString(fmt.Sprintf("         \033[38;5;%dm│\033[0m\n", 238))
		}
	}

	// Footer with stats
	eventCount := len(entries)
	interactions := 0
	for _, e := range entries {
		if e.Event == "session.block" || e.Event == "state.blocked" {
			interactions++
		}
	}
	b.WriteString(fmt.Sprintf("\n\033[38;5;241m  %d events", eventCount))
	if interactions > 0 {
		b.WriteString(fmt.Sprintf("  %d interactions", interactions))
	}
	b.WriteString(fmt.Sprintf("  %s", formatDuration(last.Sub(first))))

	// Timing breakdown
	if timing != nil && (timing.TotalClaudeWork > 0 || timing.TotalUserWait > 0) {
		b.WriteString(fmt.Sprintf("  │  claude %s", formatDuration(timing.TotalClaudeWork)))
		if timing.TotalUserWait > 0 {
			b.WriteString(fmt.Sprintf("  user %s", formatDuration(timing.TotalUserWait)))
		}
		total := timing.TotalClaudeWork + timing.TotalUserWait
		if total > 0 {
			pct := float64(timing.TotalClaudeWork) / float64(total) * 100
			b.WriteString(fmt.Sprintf("  (%.0f%% active)", pct))
		}
	}

	b.WriteString("\033[0m\n")

	return b.String()
}

func eventConnectorColor(event string) int {
	switch event {
	case "session.started", "session.resumed", "session.resume", "state.working":
		return 78 // green
	case "claude.started":
		return 78 // green
	case "claude.ended":
		return 241 // dim
	case "session.block", "state.blocked":
		return 214 // orange
	case "session.end", "state.done":
		return 241 // dim
	case "permission.request":
		return 214 // orange
	case "permission.resolve":
		return 78 // green
	case "worktree.entered":
		return 78 // green
	case "worktree.exited":
		return 241 // dim
	case "gh.pr.created", "gh.pr.merged":
		return 78 // green
	case "linear.issue.read":
		return 141 // purple
	case "context.snapshot":
		return 241 // dim
	default:
		return 241
	}
}

func eventDetailColor(event string) int {
	switch event {
	case "session.block", "state.blocked":
		return 252 // bright for question text
	case "claude.started":
		return 241 // dim for claude_id
	case "worktree.entered", "worktree.exited":
		return 241 // dim
	case "gh.pr.created", "gh.pr.merged":
		return 252 // bright for PR info
	case "linear.issue.read":
		return 252 // bright for issue info
	default:
		return 241
	}
}

func eventLabel(event string) string {
	switch event {
	case "session.started":
		return "started"
	case "session.resumed":
		return "resumed"
	case "session.resume", "state.working":
		return "resumed"
	case "claude.started":
		return "claude started"
	case "claude.ended":
		return "claude ended"
	case "session.block", "state.blocked":
		return "blocked"
	case "session.end", "state.done":
		return "ended"
	case "permission.request":
		return "permission requested"
	case "permission.resolve":
		return "permission resolved"
	case "worktree.entered":
		return "entered worktree"
	case "worktree.exited":
		return "exited worktree"
	case "gh.pr.created":
		return "PR created"
	case "gh.pr.merged":
		return "PR merged"
	case "linear.issue.read":
		return "linear"
	case "context.snapshot":
		return "context"
	default:
		return event
	}
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

func formatAgo(t time.Time) string {
	d := time.Since(t)
	if d < time.Minute {
		return "just now"
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}
