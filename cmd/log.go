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

var logCmd = &cobra.Command{
	Use:   "log [session]",
	Short: "Show session activity logs",
	Long:  "Without arguments, shows a summary of all sessions. With a session name, shows the full timeline.",
	RunE:  runLog,
}

func init() {
	rootCmd.AddCommand(logCmd)
}

type logEntry struct {
	Session   string    `json:"session"`
	Status    string    `json:"status"`
	Summary   string    `json:"summary"`
	PID       int       `json:"pid"`
	Timestamp time.Time `json:"timestamp"`
}

func readLog(name string) ([]logEntry, error) {
	path := filepath.Join(session.SessionDir(name), "log.jsonl")
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var entries []logEntry
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var e logEntry
		if err := json.Unmarshal(scanner.Bytes(), &e); err != nil {
			continue
		}
		entries = append(entries, e)
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
		interactions int
		duration     time.Duration
		lastActivity time.Time
		lastSummary  string
	}

	var summaries []sessionSummary

	for _, s := range allSessions {
		log, err := readLog(s.Session)
		if err != nil || len(log) == 0 {
			continue
		}

		blocked := 0
		for _, entry := range log {
			if entry.Status == "blocked" {
				blocked++
			}
		}

		first := log[0].Timestamp
		last := log[len(log)-1].Timestamp

		summaries = append(summaries, sessionSummary{
			name:         s.Session,
			status:       log[len(log)-1].Status,
			interactions: blocked,
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

	for _, s := range summaries {
		statusIcon := "●"
		switch s.status {
		case "working":
			statusIcon = "\033[32m●\033[0m" // green
		case "blocked":
			statusIcon = "\033[33m●\033[0m" // yellow
		case "done":
			statusIcon = "\033[90m●\033[0m" // gray
		}

		dur := formatDuration(s.duration)
		ago := formatAgo(s.lastActivity)

		fmt.Printf("%s %-28s %s  %d interactions  %s ago\n",
			statusIcon, s.name, dur, s.interactions, ago)
	}

	return nil
}

func showSessionLog(name string) error {
	log, err := readLog(name)
	if err != nil {
		return fmt.Errorf("session %q: %w", name, err)
	}

	if len(log) == 0 {
		fmt.Printf("No log entries for %s.\n", name)
		return nil
	}

	fmt.Printf("\033[1m%s\033[0m\n", name)

	// Session duration
	first := log[0].Timestamp
	last := log[len(log)-1].Timestamp
	fmt.Printf("Started %s  Duration %s\n\n", first.Local().Format("Jan 2 15:04"), formatDuration(last.Sub(first)))

	var prevTime time.Time
	for _, entry := range log {
		gap := ""
		if !prevTime.IsZero() {
			d := entry.Timestamp.Sub(prevTime)
			if d > 5*time.Second {
				gap = fmt.Sprintf(" (+%s)", formatDuration(d))
			}
		}
		prevTime = entry.Timestamp

		icon := " "
		switch entry.Status {
		case "working":
			icon = "\033[32m▶\033[0m"
		case "blocked":
			icon = "\033[33m◼\033[0m"
		case "done":
			icon = "\033[90m■\033[0m"
		}

		ts := entry.Timestamp.Local().Format("15:04:05")
		summary := entry.Summary
		if len(summary) > 80 {
			summary = summary[:77] + "..."
		}

		// Escape any control chars in summary
		summary = strings.ReplaceAll(summary, "\n", " ")

		fmt.Printf("  %s %s %s%s\n", icon, ts, summary, gap)
	}

	return nil
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
