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
			} else if s, ok := e.Meta["summary"]; ok {
				summary = s
			} else if t, ok := e.Meta["tool"]; ok {
				summary = t
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

	first := log[0].TS
	last := log[len(log)-1].TS
	fmt.Printf("Started %s  Duration %s\n\n", first.Local().Format("Jan 2 15:04"), formatDuration(last.Sub(first)))

	var prevTime time.Time
	for _, entry := range log {
		gap := ""
		if !prevTime.IsZero() {
			d := entry.TS.Sub(prevTime)
			if d > 5*time.Second {
				gap = fmt.Sprintf(" (+%s)", formatDuration(d))
			}
		}
		prevTime = entry.TS

		icon := eventIcon(entry.Event)
		ts := entry.TS.Local().Format("15:04:05")

		label := entry.Event
		if entry.Summary != "" {
			label = entry.Summary
		}
		if len(label) > 80 {
			label = label[:77] + "..."
		}
		label = strings.ReplaceAll(label, "\n", " ")

		fmt.Printf("  %s %s %-22s %s%s\n", icon, ts, eventLabel(entry.Event), label, gap)
	}

	return nil
}

func eventIcon(event string) string {
	switch event {
	case "session.started", "session.resumed", "session.resume", "state.working":
		return "\033[32m▶\033[0m"
	case "session.block", "state.blocked":
		return "\033[33m◼\033[0m"
	case "session.end", "state.done":
		return "\033[90m■\033[0m"
	case "permission.request":
		return "\033[33m🔒\033[0m"
	case "permission.resolve":
		return "\033[32m🔓\033[0m"
	default:
		return " "
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
	case "session.block", "state.blocked":
		return "blocked"
	case "session.end", "state.done":
		return "ended"
	case "permission.request":
		return "permission requested"
	case "permission.resolve":
		return "permission resolved"
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
