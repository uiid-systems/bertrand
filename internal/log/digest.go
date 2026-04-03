package log

import (
	"fmt"
	"strings"
	"time"

	"github.com/uiid-systems/bertrand/internal/schema"
)

// DigestOptions controls what gets included in a SessionDigest.
type DigestOptions struct {
	IncludeFullEvents bool // include the uncompacted Events list
}

// Digest returns a full enriched SessionDigest for a session.
func Digest(name string) (*SessionDigest, error) {
	return DigestWithOptions(name, DigestOptions{})
}

// DigestWithOptions returns a SessionDigest with configurable options.
func DigestWithOptions(name string, opts DigestOptions) (*SessionDigest, error) {
	raw, err := ReadEvents(name)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("no events for session %q", name)
	}

	enriched := EnrichAll(raw)
	timing := schema.ComputeTimings(raw)

	first := raw[0].TS
	last := raw[len(raw)-1].TS

	// Compute counts
	interactions := 0
	conversations := 0
	prs := 0
	for _, e := range raw {
		switch e.Event {
		case "session.block", "state.blocked":
			interactions++
		case "claude.started":
			conversations++
		case "gh.pr.created":
			prs++
		}
	}

	// Timing breakdown
	total := timing.TotalClaudeWork + timing.TotalUserWait
	activePct := 0
	if total > 0 {
		activePct = int(float64(timing.TotalClaudeWork) / float64(total) * 100)
	}

	// Chart-ready aggregations
	activityByHour := make(map[int]int)
	eventDist := make(map[string]int)
	timeDist := map[string]int{
		"claude_work": int(timing.TotalClaudeWork.Seconds()),
		"user_wait":   int(timing.TotalUserWait.Seconds()),
	}

	for _, e := range enriched {
		activityByHour[e.TS.Hour()]++
		eventDist[e.Event]++
	}

	d := &SessionDigest{
		Session:       name,
		StartedAt:     first,
		EndedAt:       last,
		DurationS:     int(last.Sub(first).Seconds()),
		EventCount:    len(enriched),
		Interactions:  interactions,
		Conversations: conversations,
		PRs:           prs,
		Timing: TimingBreakdown{
			ClaudeWorkS: int(timing.TotalClaudeWork.Seconds()),
			UserWaitS:   int(timing.TotalUserWait.Seconds()),
			ActivePct:   activePct,
		},
		Timeline:          Compact(enriched),
		ActivityByHour:    activityByHour,
		EventDistribution: eventDist,
		TimeDistribution:  timeDist,
		TimingRaw:         timing,
	}

	if opts.IncludeFullEvents {
		d.Events = enriched
	}

	return d, nil
}

// ContractDigest returns a markdown timeline string for contract injection.
// This replaces session.LogDigest().
func ContractDigest(name string) string {
	raw, err := ReadEvents(name)
	if err != nil || len(raw) == 0 {
		return ""
	}

	var lines []string
	var firstTS, lastTS time.Time
	eventCount := 0

	for _, te := range raw {
		// Skip legacy state entries for digest
		if strings.HasPrefix(te.Event, "state.") {
			continue
		}

		eventCount++
		if firstTS.IsZero() {
			firstTS = te.TS
		}
		lastTS = te.TS

		ts := te.TS.Format("15:04")

		switch te.Event {
		case "session.started":
			lines = append(lines, fmt.Sprintf("- %s session started", ts))
		case "session.resumed":
			lines = append(lines, fmt.Sprintf("- %s session resumed", ts))
		case "claude.started":
			id := te.MetaClaudeID()
			if len(id) > 8 {
				id = id[:8]
			}
			lines = append(lines, fmt.Sprintf("- %s claude conversation started (%s)", ts, id))
		case "claude.ended":
			lines = append(lines, fmt.Sprintf("- %s claude conversation ended", ts))
		case "session.block":
			q := te.MetaSummary()
			if len(q) > 80 {
				q = q[:77] + "..."
			}
			if q != "" {
				lines = append(lines, fmt.Sprintf("- %s blocked: %q", ts, q))
			} else {
				lines = append(lines, fmt.Sprintf("- %s blocked", ts))
			}
		case "session.resume":
			lines = append(lines, fmt.Sprintf("- %s user responded", ts))
		case "session.end":
			summary := te.MetaSummary()
			if summary != "" && summary != "Session ended" {
				lines = append(lines, fmt.Sprintf("- %s ended: %q", ts, summary))
			} else {
				lines = append(lines, fmt.Sprintf("- %s ended", ts))
			}
		case "permission.request":
			tool := te.MetaSummary()
			if tool != "" {
				lines = append(lines, fmt.Sprintf("- %s permission: %s", ts, tool))
			}
		case "worktree.entered":
			branch := te.MetaSummary()
			if branch != "" {
				lines = append(lines, fmt.Sprintf("- %s entered worktree (%s)", ts, branch))
			} else {
				lines = append(lines, fmt.Sprintf("- %s entered worktree", ts))
			}
		case "worktree.exited":
			lines = append(lines, fmt.Sprintf("- %s exited worktree", ts))
		case "gh.pr.created":
			lines = append(lines, fmt.Sprintf("- %s PR created: %s", ts, te.MetaSummary()))
		case "gh.pr.merged":
			lines = append(lines, fmt.Sprintf("- %s PR merged: %s", ts, te.MetaSummary()))
		case "linear.issue.read":
			lines = append(lines, fmt.Sprintf("- %s linear: %s", ts, te.MetaSummary()))
		case "claude.discarded":
			id := te.MetaClaudeID()
			if len(id) > 8 {
				id = id[:8]
			}
			lines = append(lines, fmt.Sprintf("- %s claude conversation discarded (%s)", ts, id))
		case "context.snapshot":
			// Skip context snapshots in digest -- too noisy
		}
	}

	if len(lines) == 0 {
		return ""
	}

	duration := lastTS.Sub(firstTS).Round(time.Second)
	header := fmt.Sprintf("## Session Timeline (%d events, %s)", eventCount, duration)

	// Add timing breakdown if available
	timing := schema.ComputeTimings(raw)
	if timing.TotalClaudeWork > 0 || timing.TotalUserWait > 0 {
		total := timing.TotalClaudeWork + timing.TotalUserWait
		if total > 0 {
			pct := float64(timing.TotalClaudeWork) / float64(total) * 100
			lines = append(lines, fmt.Sprintf("- Timing: claude %s, user %s (%.0f%% active)",
				timing.TotalClaudeWork.Round(time.Second),
				timing.TotalUserWait.Round(time.Second), pct))
		}
	}

	return header + "\n" + strings.Join(lines, "\n")
}

// SiblingDigest returns a compact pipe-delimited summary of the last maxEvents
// events for a session. Designed for sibling context injection where token
// budget is tight.
func SiblingDigest(name string, maxEvents int) string {
	raw, err := ReadEvents(name)
	if err != nil || len(raw) == 0 {
		return ""
	}

	// Take only the tail
	if len(raw) > maxEvents {
		raw = raw[len(raw)-maxEvents:]
	}

	var parts []string
	for _, te := range raw {
		if strings.HasPrefix(te.Event, "state.") || te.Event == "context.snapshot" {
			continue
		}

		ts := te.TS.Format("15:04")

		switch te.Event {
		case "session.started":
			parts = append(parts, ts+" started")
		case "session.resumed":
			parts = append(parts, ts+" resumed")
		case "claude.started":
			parts = append(parts, ts+" claude started")
		case "claude.ended":
			parts = append(parts, ts+" claude ended")
		case "session.block":
			q := te.MetaSummary()
			if len(q) > 40 {
				q = q[:37] + "..."
			}
			if q != "" {
				parts = append(parts, fmt.Sprintf("%s blocked: %q", ts, q))
			} else {
				parts = append(parts, ts+" blocked")
			}
		case "session.resume":
			parts = append(parts, ts+" resumed")
		case "session.end":
			parts = append(parts, ts+" ended")
		case "worktree.entered":
			branch := te.MetaSummary()
			if branch != "" {
				parts = append(parts, fmt.Sprintf("%s worktree (%s)", ts, branch))
			}
		case "gh.pr.created":
			parts = append(parts, fmt.Sprintf("%s PR: %s", ts, te.MetaSummary()))
		case "gh.pr.merged":
			parts = append(parts, fmt.Sprintf("%s merged: %s", ts, te.MetaSummary()))
		case "linear.issue.read":
			parts = append(parts, fmt.Sprintf("%s linear: %s", ts, te.MetaSummary()))
		}
	}

	if len(parts) == 0 {
		return ""
	}

	return strings.Join(parts, " | ")
}

// SiblingPRs extracts PR URLs from a session's events.
func SiblingPRs(name string) []string {
	raw, err := ReadEvents(name)
	if err != nil {
		return nil
	}

	var urls []string
	for _, te := range raw {
		if te.Event == "gh.pr.created" {
			if m, ok := te.TypedMeta.(*schema.GhPrCreatedMeta); ok && m.PRURL != "" {
				urls = append(urls, m.PRURL)
			}
		}
	}
	return urls
}

// SiblingConversationCount returns the number of Claude conversations in a session.
func SiblingConversationCount(name string) int {
	raw, err := ReadEvents(name)
	if err != nil {
		return 0
	}

	count := 0
	for _, te := range raw {
		if te.Event == "claude.started" {
			count++
		}
	}
	return count
}
