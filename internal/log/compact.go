package log

import (
	"fmt"
	"strings"
)

// Compact collapses noisy event sequences into a more readable timeline:
//   - Consecutive permission.request/permission.resolve pairs are collapsed into
//     a single "tool work" summary (e.g., "8x Bash, 2x Edit")
//   - Consecutive duplicate events (same event type) are deduplicated
//   - Events with Skip=true in the catalog are dropped (e.g., context.snapshot)
func Compact(events []EnrichedEvent) []EnrichedEvent {
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
			toolCounts := make(map[string]int)
			firstTS := entry.TS
			var lastTS = entry.TS
			j := i
			for j < len(events) {
				e := events[j]
				if e.Event == "permission.request" {
					tool := e.Summary
					if tool == "" {
						tool = "unknown"
					}
					toolCounts[tool]++
					lastTS = e.TS
					j++
				} else if e.Event == "permission.resolve" {
					lastTS = e.TS
					j++
				} else {
					break
				}
			}
			// Build summary like "3x Bash, 1x Edit"
			type toolCount struct {
				tool  string
				count int
			}
			var sorted []toolCount
			for tool, count := range toolCounts {
				sorted = append(sorted, toolCount{tool, count})
			}
			// Sort by count descending for readability
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
			summary := strings.Join(parts, ", ")
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
