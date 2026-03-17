package cmd

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	sessionlog "github.com/uiid-systems/bertrand/internal/log"
	"github.com/uiid-systems/bertrand/internal/schema"
	"github.com/uiid-systems/bertrand/internal/session"
)

var jsonOutput bool

var logCmd = &cobra.Command{
	Use:   "log [session]",
	Short: "Show session activity logs",
	Long:  "Without arguments, shows a summary of all sessions. With a session name, shows the full timeline.",
	ValidArgsFunction: func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		if len(args) > 0 {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		sessions, err := session.ListSessions()
		if err != nil {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		var names []string
		for _, s := range sessions {
			names = append(names, s.Session+"\t"+s.Summary)
		}
		return names, cobra.ShellCompDirectiveNoFileComp
	},
	RunE: runLog,
}

func init() {
	logCmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON lines")
	rootCmd.AddCommand(logCmd)
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
	}

	var summaries []sessionSummary

	for _, s := range allSessions {
		d, err := sessionlog.Digest(s.Session)
		if err != nil {
			continue
		}

		summaries = append(summaries, sessionSummary{
			name:         s.Session,
			status:       s.Status,
			events:       d.EventCount,
			interactions: d.Interactions,
			duration:     d.EndedAt.Sub(d.StartedAt),
			lastActivity: d.EndedAt,
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
				"session":       s.name,
				"status":        s.status,
				"events":        s.events,
				"interactions":  s.interactions,
				"duration_s":    int(s.duration.Seconds()),
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
		case "prompting":
			statusIcon = "\033[36m●\033[0m"
		case "paused":
			statusIcon = "\033[90m●\033[0m"
		case "archived":
			statusIcon = "\033[90m○\033[0m"
		}

		dur := sessionlog.FormatDuration(s.duration)
		ago := sessionlog.FormatAgo(s.lastActivity)

		fmt.Printf("%s %-28s %s  %d events  %d interactions  %s ago\n",
			statusIcon, s.name, dur, s.events, s.interactions, ago)
	}

	return nil
}

func showSessionLog(name string) error {
	d, err := sessionlog.DigestWithOptions(name, sessionlog.DigestOptions{IncludeFullEvents: true})
	if err != nil {
		return fmt.Errorf("session %q: %w", name, err)
	}

	if jsonOutput {
		for _, entry := range d.Events {
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
			"_type":               "timing_summary",
			"total_claude_work_s": d.Timing.ClaudeWorkS,
			"total_user_wait_s":   d.Timing.UserWaitS,
		})
		fmt.Println(string(data))
		return nil
	}

	fmt.Printf("\033[1m%s\033[0m\n", name)
	fmt.Print(renderTimeline(d.Timeline, d.TimingRaw))
	return nil
}

// renderTimeline formats enriched events as a vertical pipe timeline.
// Used by both `bertrand log <session>` and the exit screen.
// timing is optional — pass nil to skip timing display in footer.
func renderTimeline(entries []sessionlog.EnrichedEvent, timing *schema.TimingSummary) string {
	if len(entries) == 0 {
		return ""
	}

	var b strings.Builder
	first := entries[0].TS
	last := entries[len(entries)-1].TS

	b.WriteString(fmt.Sprintf("\033[38;5;241mStarted %s  Duration %s\033[0m\n\n",
		first.Local().Format("Jan 2 15:04"), sessionlog.FormatDuration(last.Sub(first))))

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
		info := sessionlog.Lookup(entry.Event)
		coloredConnector := fmt.Sprintf("\033[38;5;%dm%s\033[0m", info.ColorANSI, connector)

		ts := entry.TS.Local().Format("15:04")

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
				gap = fmt.Sprintf(" \033[38;5;241m+%s\033[0m", sessionlog.FormatDuration(d))
			}
		}

		// Format: "  HH:MM  ├ label  detail  +gap"
		if detail != "" {
			b.WriteString(fmt.Sprintf("  \033[38;5;241m%s\033[0m  %s \033[38;5;252m%s\033[0m  \033[38;5;%dm%s\033[0m%s\n",
				ts, coloredConnector, entry.Label, info.DetailANSI, detail, gap))
		} else {
			b.WriteString(fmt.Sprintf("  \033[38;5;241m%s\033[0m  %s \033[38;5;252m%s\033[0m%s\n",
				ts, coloredConnector, entry.Label, gap))
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
	b.WriteString(fmt.Sprintf("  %s", sessionlog.FormatDuration(last.Sub(first))))

	// Timing breakdown
	if timing != nil && (timing.TotalClaudeWork > 0 || timing.TotalUserWait > 0) {
		b.WriteString(fmt.Sprintf("  │  claude %s", sessionlog.FormatDuration(timing.TotalClaudeWork)))
		if timing.TotalUserWait > 0 {
			b.WriteString(fmt.Sprintf("  user %s", sessionlog.FormatDuration(timing.TotalUserWait)))
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
