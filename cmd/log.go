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

// unifiedEntry normalizes both old State entries and new LogEvent entries.
type unifiedEntry struct {
	Event   string            // e.g., "session.block", "permission.request", or legacy "state.working"
	Session string
	TS      time.Time
	Summary string
	Meta    map[string]string
}

func readUnifiedLog(name string) ([]unifiedEntry, error) {
	path := filepath.Join(session.SessionDir(name), "log.jsonl")
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var entries []unifiedEntry
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var raw map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &raw); err != nil {
			continue
		}

		if _, hasEvent := raw["event"]; hasEvent {
			// New LogEvent format
			var e session.LogEvent
			if json.Unmarshal(scanner.Bytes(), &e) != nil {
				continue
			}
			summary := ""
			if q, ok := e.Meta["question"]; ok {
				summary = q
			} else if a, ok := e.Meta["answer"]; ok && a != "" {
				summary = a
			} else if s, ok := e.Meta["summary"]; ok {
				summary = s
			} else if t, ok := e.Meta["tool"]; ok {
				summary = t
			} else if br, ok := e.Meta["branch"]; ok {
				summary = br
			} else if cid, ok := e.Meta["claude_id"]; ok {
				if len(cid) > 8 {
					cid = cid[:8]
				}
				summary = cid
			}
			entries = append(entries, unifiedEntry{
				Event:   e.Event,
				Session: e.Session,
				TS:      e.TS,
				Summary: summary,
				Meta:    e.Meta,
			})
		} else {
			// Legacy State format
			var s session.State
			if json.Unmarshal(scanner.Bytes(), &s) != nil {
				continue
			}
			entries = append(entries, unifiedEntry{
				Event:   "state." + s.Status,
				Session: s.Session,
				TS:      s.Timestamp,
				Summary: s.Summary,
			})
		}
	}
	return entries, scanner.Err()
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
	log, err := readUnifiedLog(name)
	if err != nil {
		return fmt.Errorf("session %q: %w", name, err)
	}

	if len(log) == 0 {
		fmt.Printf("No log entries for %s.\n", name)
		return nil
	}

	if jsonOutput {
		for _, entry := range log {
			data, _ := json.Marshal(map[string]interface{}{
				"event":   entry.Event,
				"session": entry.Session,
				"ts":      entry.TS,
				"summary": entry.Summary,
				"meta":    entry.Meta,
			})
			fmt.Println(string(data))
		}
		return nil
	}

	fmt.Printf("\033[1m%s\033[0m\n", name)
	fmt.Print(renderTimeline(log))
	return nil
}

// compactEntry represents a collapsed/deduped timeline entry.
type compactEntry struct {
	Event    string
	TS       time.Time
	Summary  string
	Answer   string            // answer from the following session.resume, if any
	Meta     map[string]string // original meta for Q&A pairing
	ToolWork string            // collapsed permission summary like "8× Bash, 2× Edit"
	RawCount int               // number of raw events this entry represents
}

// compactTimeline collapses permission pairs and deduplicates consecutive events.
func compactTimeline(entries []unifiedEntry) []compactEntry {
	var result []compactEntry
	i := 0
	for i < len(entries) {
		e := entries[i]

		// Skip permission events — they'll be collected as tool work
		if e.Event == "permission.request" || e.Event == "permission.resolve" {
			i++
			continue
		}

		// Deduplicate: skip if identical event+summary as previous compact entry
		if len(result) > 0 {
			prev := result[len(result)-1]
			if prev.Event == e.Event && prev.Summary == e.Summary {
				result[len(result)-1].RawCount++
				i++
				continue
			}
		}

		ce := compactEntry{
			Event:    e.Event,
			TS:       e.TS,
			Summary:  e.Summary,
			Meta:     e.Meta,
			RawCount: 1,
		}

		// For block events, look ahead for the paired resume to capture the answer
		if e.Event == "session.block" || e.Event == "state.blocked" {
			for j := i + 1; j < len(entries); j++ {
				ej := entries[j]
				if ej.Event == "session.resume" || ej.Event == "state.working" {
					if a, ok := ej.Meta["answer"]; ok && a != "" {
						ce.Answer = a
					}
					break
				}
				// Stop looking if we hit another block
				if ej.Event == "session.block" || ej.Event == "state.blocked" {
					break
				}
			}
		}

		// For non-permission events, look ahead and collect any following permission
		// events as tool work summary, attaching to this entry
		if e.Event != "session.block" && e.Event != "state.blocked" {
			toolCounts := map[string]int{}
			rawPermCount := 0
			j := i + 1
			for j < len(entries) {
				ej := entries[j]
				if ej.Event == "permission.request" || ej.Event == "permission.resolve" {
					if ej.Event == "permission.resolve" {
						tool := ej.Meta["tool"]
						if tool == "" {
							tool = "unknown"
						}
						toolCounts[tool]++
					}
					rawPermCount++
					j++
					continue
				}
				break
			}
			if len(toolCounts) > 0 {
				ce.ToolWork = formatToolCounts(toolCounts)
				ce.RawCount += rawPermCount
			}
		}

		result = append(result, ce)
		i++
	}
	return result
}

// formatToolCounts formats a map of tool→count into "8× Bash, 2× Edit".
func formatToolCounts(counts map[string]int) string {
	// Sort by count descending, then name ascending
	type tc struct {
		name  string
		count int
	}
	var items []tc
	for name, count := range counts {
		items = append(items, tc{name, count})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].count != items[j].count {
			return items[i].count > items[j].count
		}
		return items[i].name < items[j].name
	})
	var parts []string
	for _, item := range items {
		parts = append(parts, fmt.Sprintf("%d× %s", item.count, item.name))
	}
	return strings.Join(parts, ", ")
}

// renderTimeline formats log entries as a vertical pipe timeline.
// Used by both `bertrand log <session>` and the exit screen.
func renderTimeline(entries []unifiedEntry) string {
	if len(entries) == 0 {
		return ""
	}

	compact := compactTimeline(entries)
	if len(compact) == 0 {
		return ""
	}

	var b strings.Builder
	first := entries[0].TS
	last := entries[len(entries)-1].TS

	b.WriteString(fmt.Sprintf("\033[38;5;241mStarted %s  Duration %s\033[0m\n\n",
		first.Local().Format("Jan 2 15:04"), formatDuration(last.Sub(first))))

	var prevTS time.Time
	for i, ce := range compact {
		isFirst := i == 0
		isLast := i == len(compact)-1

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
		connectorColor := eventConnectorColor(ce.Event)
		coloredConnector := fmt.Sprintf("\033[38;5;%dm%s\033[0m", connectorColor, connector)

		ts := ce.TS.Local().Format("15:04")
		label := eventLabel(ce.Event)

		// Build the detail text
		detail := ""
		if ce.Summary != "" {
			detail = ce.Summary
			if len(detail) > 60 {
				detail = detail[:57] + "..."
			}
			detail = strings.ReplaceAll(detail, "\n", " ")
		}

		// Gap indicator (based on previous compact entry, not raw)
		gap := ""
		if !isFirst {
			d := ce.TS.Sub(prevTS)
			if d > 5*time.Second {
				gap = fmt.Sprintf(" \033[38;5;241m+%s\033[0m", formatDuration(d))
			}
		}
		prevTS = ce.TS

		// Format: "  HH:MM  ├ label  detail  +gap"
		if detail != "" {
			b.WriteString(fmt.Sprintf("  \033[38;5;241m%s\033[0m  %s \033[38;5;252m%s\033[0m  \033[38;5;%dm%s\033[0m%s\n",
				ts, coloredConnector, label, eventDetailColor(ce.Event), detail, gap))
		} else {
			b.WriteString(fmt.Sprintf("  \033[38;5;241m%s\033[0m  %s \033[38;5;252m%s\033[0m%s\n",
				ts, coloredConnector, label, gap))
		}

		// Show answer on the next line if present (Q&A pair)
		if ce.Answer != "" {
			answer := ce.Answer
			if len(answer) > 60 {
				answer = answer[:57] + "..."
			}
			answer = strings.ReplaceAll(answer, "\n", " ")
			b.WriteString(fmt.Sprintf("         \033[38;5;238m│\033[0m  \033[38;5;78m→ %s\033[0m\n", answer))
		}

		// Show tool work summary on the pipe line if present
		if ce.ToolWork != "" {
			b.WriteString(fmt.Sprintf("         \033[38;5;238m│\033[0m  \033[38;5;241m%s\033[0m\n", ce.ToolWork))
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
	b.WriteString(fmt.Sprintf("  %s\033[0m\n", formatDuration(last.Sub(first))))

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
