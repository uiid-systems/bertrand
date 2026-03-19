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

// conversationSegment groups enriched events that belong to a single Claude conversation.
type conversationSegment struct {
	claudeID string
	events   []sessionlog.EnrichedEvent
}

// splitByConversation groups timeline events into conversation segments.
// Each segment represents one Claude conversation run. Events like session.started
// and session.resumed are absorbed into the segment of the claude.started that follows.
func splitByConversation(entries []sessionlog.EnrichedEvent) []conversationSegment {
	if len(entries) == 0 {
		return nil
	}

	var segments []conversationSegment
	var pending []sessionlog.EnrichedEvent // events buffered before a claude.started

	for _, entry := range entries {
		if entry.Event == "claude.started" {
			// Start a new segment, pulling in any buffered preamble events
			seg := conversationSegment{claudeID: entry.ClaudeID}
			seg.events = append(seg.events, pending...)
			seg.events = append(seg.events, entry)
			segments = append(segments, seg)
			pending = nil
			continue
		}

		if len(segments) == 0 {
			// Buffer events before first claude.started
			pending = append(pending, entry)
		} else {
			// Append to current segment
			segments[len(segments)-1].events = append(segments[len(segments)-1].events, entry)
		}
	}

	// If there were only buffered events and no claude.started, make a single segment
	if len(segments) == 0 && len(pending) > 0 {
		segments = append(segments, conversationSegment{events: pending})
	}

	return segments
}

// renderTimeline formats enriched events as a vertical pipe timeline.
// Used by both `bertrand log <session>` and the exit screen.
// timing is optional — pass nil to skip timing display in footer.
func renderTimeline(entries []sessionlog.EnrichedEvent, timing *schema.TimingSummary) string {
	if len(entries) == 0 {
		return ""
	}

	segments := splitByConversation(entries)

	// If there's only one segment, render flat (no conversation headers)
	singleSegment := len(segments) == 1

	var b strings.Builder
	first := entries[0].TS
	last := entries[len(entries)-1].TS

	b.WriteString(fmt.Sprintf("\033[38;5;241mStarted %s  Duration %s\033[0m\n",
		first.Local().Format("Jan 2 15:04"), sessionlog.FormatDuration(last.Sub(first))))

	var prevSegEnd time.Time
	for _, seg := range segments {
		if len(seg.events) == 0 {
			continue
		}

		segFirst := seg.events[0].TS
		segLast := seg.events[len(seg.events)-1].TS

		// Conversation header (skip for single-segment timelines)
		if !singleSegment {
			b.WriteString("\n")

			// Gap from previous segment
			gap := ""
			if !prevSegEnd.IsZero() {
				d := segFirst.Sub(prevSegEnd)
				if d > 5*time.Second {
					gap = fmt.Sprintf("  \033[38;5;241m+%s\033[0m", sessionlog.FormatDuration(d))
				}
			}

			// Header with date and conversation ID
			date := segFirst.Local().Format("Jan 2")
			dur := sessionlog.FormatDuration(segLast.Sub(segFirst))
			cid := seg.claudeID
			if len(cid) > 8 {
				cid = cid[:8]
			}
			if cid != "" {
				b.WriteString(fmt.Sprintf("  \033[38;5;252m%s\033[0m  \033[38;5;241m%s  %s\033[0m%s\n\n",
					date, cid, dur, gap))
			} else {
				b.WriteString(fmt.Sprintf("  \033[38;5;252m%s\033[0m  \033[38;5;241m%s\033[0m%s\n\n",
					date, dur, gap))
			}
		} else {
			b.WriteString("\n")
		}

		renderSegmentEvents(&b, seg.events)
		prevSegEnd = segLast
	}

	// Footer — prominent stats table
	eventCount := len(entries)
	interactions := 0
	conversations := 0
	for _, e := range entries {
		switch e.Event {
		case "session.block", "state.blocked":
			interactions++
		case "claude.started":
			conversations++
		}
	}

	b.WriteString("\n")
	b.WriteString("  \033[38;5;241m─────────────────────────────────────────\033[0m\n")

	// Row 1: events, interactions, conversations
	var stats []string
	stats = append(stats, fmt.Sprintf("\033[38;5;252m%d\033[38;5;241m events", eventCount))
	if interactions > 0 {
		stats = append(stats, fmt.Sprintf("\033[38;5;252m%d\033[38;5;241m interactions", interactions))
	}
	if conversations > 1 {
		stats = append(stats, fmt.Sprintf("\033[38;5;252m%d\033[38;5;241m conversations", conversations))
	}
	b.WriteString(fmt.Sprintf("  \033[38;5;241m%s\033[0m\n", strings.Join(stats, "  ")))

	// Row 2: timing breakdown
	if timing != nil && (timing.TotalClaudeWork > 0 || timing.TotalUserWait > 0) {
		total := timing.TotalClaudeWork + timing.TotalUserWait
		pctStr := ""
		if total > 0 {
			pct := float64(timing.TotalClaudeWork) / float64(total) * 100
			pctStr = fmt.Sprintf("  \033[38;5;78m%.0f%% active\033[0m", pct)
		}
		b.WriteString(fmt.Sprintf("  \033[38;5;241mclaude \033[38;5;252m%s\033[38;5;241m  user \033[38;5;252m%s\033[0m%s\n",
			sessionlog.FormatDuration(timing.TotalClaudeWork),
			sessionlog.FormatDuration(timing.TotalUserWait),
			pctStr))
	} else {
		b.WriteString(fmt.Sprintf("  \033[38;5;241mduration \033[38;5;252m%s\033[0m\n", sessionlog.FormatDuration(last.Sub(first))))
	}

	return b.String()
}

// renderSegmentEvents renders a single conversation's events with ┌├└ connectors.
// Q&A pairs (session.block → session.resume) are rendered as coupled pairs.
func renderSegmentEvents(b *strings.Builder, events []sessionlog.EnrichedEvent) {
	for i, entry := range events {
		isFirst := i == 0

		// Skip session.resume — rendered inline with the preceding session.block
		if entry.Event == "session.resume" && i > 0 && events[i-1].Event == "session.block" {
			continue
		}

		// Check if this is the last visible event (account for inline-rendered answers)
		isLast := i == len(events)-1
		if !isLast && i+1 == len(events)-1 && events[i+1].Event == "session.resume" && entry.Event == "session.block" {
			isLast = true // next event will be rendered inline, so this is effectively last
		}

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
		detail := formatDetail(entry.Summary)

		// Gap indicator
		gap := ""
		if i > 0 {
			d := entry.TS.Sub(events[i-1].TS)
			if d > 5*time.Second {
				gap = fmt.Sprintf(" \033[38;5;241m+%s\033[0m", sessionlog.FormatDuration(d))
			}
		}

		// Render the event line
		if entry.Event == "session.block" {
			// Q&A: label + gap on primary line, question (italic/dim) + answer as sub-lines
			b.WriteString(fmt.Sprintf("  \033[38;5;241m%s\033[0m  %s \033[38;5;252m%s\033[0m%s\n",
				ts, coloredConnector, entry.Label, gap))

			pipeColor := 238

			// Question sub-line (italic, dimmed)
			if detail != "" {
				b.WriteString(fmt.Sprintf("         \033[38;5;%dm│\033[0m  \033[3;38;5;245m%s\033[0m\n",
					pipeColor, detail))
			}

			// Answer sub-line (from paired session.resume)
			if i+1 < len(events) && events[i+1].Event == "session.resume" {
				answer := formatDetail(events[i+1].Summary)
				answerGap := ""
				d := events[i+1].TS.Sub(entry.TS)
				if d > 5*time.Second {
					answerGap = fmt.Sprintf(" \033[38;5;241m+%s\033[0m", sessionlog.FormatDuration(d))
				}
				if answer != "" {
					b.WriteString(fmt.Sprintf("         \033[38;5;%dm│\033[0m  \033[38;5;252m%s\033[0m%s\n",
						pipeColor, answer, answerGap))
				} else if answerGap != "" && d > time.Minute {
					// Only show "responded" sub-line when there was a meaningful wait
					b.WriteString(fmt.Sprintf("         \033[38;5;%dm│\033[0m  \033[38;5;241mresponded\033[0m%s\n",
						pipeColor, answerGap))
				}
			}
		} else if detail != "" {
			b.WriteString(fmt.Sprintf("  \033[38;5;241m%s\033[0m  %s \033[38;5;252m%s\033[0m  \033[38;5;%dm%s\033[0m%s\n",
				ts, coloredConnector, entry.Label, info.DetailANSI, detail, gap))
		} else {
			b.WriteString(fmt.Sprintf("  \033[38;5;241m%s\033[0m  %s \033[38;5;252m%s\033[0m%s\n",
				ts, coloredConnector, entry.Label, gap))
		}

		// Draw a pipe between entries (except after last)
		// Also check if the next event is a session.resume that was rendered inline
		nextIdx := i + 1
		if nextIdx < len(events) && events[nextIdx].Event == "session.resume" && entry.Event == "session.block" {
			nextIdx++ // skip the inline-rendered answer
		}
		if nextIdx < len(events) {
			b.WriteString(fmt.Sprintf("         \033[38;5;%dm│\033[0m\n", 238))
		}
	}
}

func formatDetail(s string) string {
	if s == "" {
		return ""
	}
	if len(s) > 60 {
		s = s[:57] + "..."
	}
	return strings.ReplaceAll(s, "\n", " ")
}
