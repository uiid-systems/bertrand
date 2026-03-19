package log

import (
	"fmt"
	"strings"

	"github.com/uiid-systems/bertrand/internal/schema"
)

// Compact collapses noisy event sequences into a more readable timeline:
//   - Q&A re-pairing: session.resume events are relocated next to their matching session.block
//   - Consecutive permission.request/permission.resolve pairs are collapsed into
//     a single "tool work" summary (e.g., "8× Bash, 2× Edit")
//   - Solo permission.resolve events are absorbed or rendered as "allowed {Tool}"
//   - Consecutive duplicate events (same event type) are deduplicated
//   - Events with Skip=true in the catalog are dropped (e.g., context.snapshot)
func Compact(events []EnrichedEvent) []EnrichedEvent {
	// Pass 1: Re-pair Q&A — relocate each session.resume to immediately after
	// its matching session.block (matched by claude_id, closest preceding block).
	events = repairQAPairs(events)

	var result []EnrichedEvent

	i := 0
	for i < len(events) {
		entry := events[i]

		// Drop events marked as Skip in the catalog
		if Lookup(entry.Event).Skip {
			i++
			continue
		}

		// Collapse permission pairs into tool work summaries
		if entry.Event == "permission.request" {
			var details []permDetail
			firstTS := entry.TS
			var lastTS = entry.TS
			j := i
			for j < len(events) {
				e := events[j]
				if e.Event == "permission.request" {
					tool, detail := extractPermissionInfo(e)
					details = append(details, permDetail{tool, detail})
					lastTS = e.TS
					j++
				} else if e.Event == "permission.resolve" {
					lastTS = e.TS
					j++
				} else {
					break
				}
			}

			summary := buildToolWorkSummary(details)
			// Use the midpoint timestamp for display
			ts := firstTS
			if !lastTS.IsZero() {
				ts = firstTS.Add(lastTS.Sub(firstTS) / 2)
			}
			info := Lookup("tool.work")
			result = append(result, EnrichedEvent{
				Event:    "tool.work",
				Session:  entry.Session,
				TS:       ts,
				Summary:  summary,
				Label:    info.Label,
				Category: info.Category,
				Color:    info.Color,
			})
			i = j
			continue
		}

		// Absorb solo permission.resolve into neighboring tool.work or render as "allowed"
		if entry.Event == "permission.resolve" {
			// If the previous result is tool.work, skip (already accounted for)
			if len(result) > 0 && result[len(result)-1].Event == "tool.work" {
				i++
				continue
			}
			// Otherwise render as "allowed {Tool}"
			tool, detail := extractPermissionInfo(entry)
			label := "allowed"
			summary := tool
			if detail != "" {
				summary = detail
			}
			info := Lookup("permission.resolve")
			result = append(result, EnrichedEvent{
				Event:    "permission.resolve",
				Session:  entry.Session,
				TS:       entry.TS,
				Summary:  summary,
				Label:    label,
				Category: info.Category,
				Color:    info.Color,
			})
			i++
			continue
		}

		// Dedup consecutive identical events
		if len(result) > 0 && result[len(result)-1].Event == entry.Event {
			// Keep the later one (update timestamp), skip the earlier
			result[len(result)-1] = entry
			i++
			continue
		}

		result = append(result, entry)
		i++
	}

	return result
}

// repairQAPairs relocates each session.resume to immediately after its matching
// session.block (matched by claude_id, closest preceding block). This ensures
// the renderer's adjacency-based pairing logic works even when permission events
// appear between the block and resume.
func repairQAPairs(events []EnrichedEvent) []EnrichedEvent {
	// Find all session.resume events and their matching blocks
	type resumeInfo struct {
		idx      int
		claudeID string
	}
	var resumes []resumeInfo
	for i, e := range events {
		if e.Event == "session.resume" {
			resumes = append(resumes, resumeInfo{i, e.ClaudeID})
		}
	}

	if len(resumes) == 0 {
		return events
	}

	// Build a set of resume indices that need relocation
	relocate := make(map[int]int) // resume index → target block index
	for _, r := range resumes {
		// Find the closest preceding session.block with matching claude_id
		bestBlock := -1
		for j := r.idx - 1; j >= 0; j-- {
			if events[j].Event == "session.block" && events[j].ClaudeID == r.claudeID {
				bestBlock = j
				break
			}
		}
		if bestBlock >= 0 && bestBlock+1 != r.idx {
			// Needs relocation — it's not already adjacent
			relocate[r.idx] = bestBlock
		}
	}

	if len(relocate) == 0 {
		return events
	}

	// Rebuild the event list with resumes relocated
	// First, collect events without relocated resumes
	var filtered []EnrichedEvent
	// A block may have multiple resumes targeting it (e.g. duplicate claude_id),
	// so use a slice per block index.
	pendingInserts := make(map[int][]EnrichedEvent) // block index → resumes to insert after
	for ri, bi := range relocate {
		pendingInserts[bi] = append(pendingInserts[bi], events[ri])
	}

	for i, e := range events {
		if _, isRelocated := relocate[i]; isRelocated {
			continue // skip — will be inserted after its block
		}
		filtered = append(filtered, e)
		// Check if resumes should be inserted after this block
		if resumes, ok := pendingInserts[i]; ok {
			filtered = append(filtered, resumes...)
		}
	}

	return filtered
}

// extractPermissionInfo extracts tool name and detail from an enriched permission event.
func extractPermissionInfo(e EnrichedEvent) (tool, detail string) {
	if pm, ok := e.Meta.(*schema.PermissionMeta); ok {
		return pm.Tool, pm.Detail
	}
	// Fallback: Summary holds the tool name (or detail if MetaSummary preferred it)
	return e.Summary, ""
}

// buildToolWorkSummary creates the summary string for a tool.work event.
// Single permission with detail → use detail directly (e.g., "ran `git tag v0.5.0`")
// Multiple permissions → count format with details where available
type permDetail struct {
	tool   string
	detail string
}

func buildToolWorkSummary(details []permDetail) string {
	// Single permission with a detail — use it directly
	if len(details) == 1 {
		d := details[0]
		if d.detail != "" {
			switch d.tool {
			case "Bash":
				return fmt.Sprintf("ran `%s`", d.detail)
			case "Edit", "Write":
				return fmt.Sprintf("edited %s", d.detail)
			default:
				return d.detail
			}
		}
		return d.tool
	}

	// Multiple permissions — count by tool
	type toolCount struct {
		tool  string
		count int
	}
	counts := make(map[string]int)
	for _, d := range details {
		counts[d.tool]++
	}
	var sorted []toolCount
	for tool, count := range counts {
		sorted = append(sorted, toolCount{tool, count})
	}
	// Sort by count descending
	for a := 0; a < len(sorted); a++ {
		for b := a + 1; b < len(sorted); b++ {
			if sorted[b].count > sorted[a].count {
				sorted[a], sorted[b] = sorted[b], sorted[a]
			}
		}
	}
	var parts []string
	for _, tc := range sorted {
		if tc.count > 1 {
			parts = append(parts, fmt.Sprintf("%d\u00d7 %s", tc.count, tc.tool))
		} else {
			parts = append(parts, tc.tool)
		}
	}
	return strings.Join(parts, ", ")
}
