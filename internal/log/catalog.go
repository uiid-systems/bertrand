package log

// EventInfo holds display metadata for a single event type.
type EventInfo struct {
	Label      string // human-readable label: "started", "blocked", "PR created"
	Category   string // "lifecycle" | "work" | "interaction" | "integration" | "context"
	Color      string // CSS var for web: "var(--green)"
	ColorANSI  int    // 256-color for terminal connector
	DetailANSI int    // ANSI color for detail/summary text
	Skip       bool   // true = drop from compact timelines
}

// Catalog maps event names to their display metadata.
var Catalog = map[string]EventInfo{
	"session.started": {Label: "bertrand started", Category: "lifecycle", Color: "var(--green)", ColorANSI: 78, DetailANSI: 241},
	"session.resumed": {Label: "resumed", Category: "lifecycle", Color: "var(--green)", ColorANSI: 78, DetailANSI: 241},
	"session.resume":  {Label: "user responded", Category: "interaction", Color: "var(--green)", ColorANSI: 78, DetailANSI: 252},
	"session.block":   {Label: "prompted", Category: "interaction", Color: "var(--orange)", ColorANSI: 214, DetailANSI: 252},
	"session.end":     {Label: "bertrand ended", Category: "lifecycle", Color: "var(--dim)", ColorANSI: 241, DetailANSI: 241},

	"claude.started":   {Label: "claude started", Category: "lifecycle", Color: "var(--green)", ColorANSI: 78, DetailANSI: 241},
	"claude.ended":     {Label: "claude ended", Category: "lifecycle", Color: "var(--dim)", ColorANSI: 241, DetailANSI: 241},
	"claude.discarded": {Label: "claude discarded", Category: "lifecycle", Color: "var(--dim)", ColorANSI: 241, DetailANSI: 241},

	"permission.request": {Label: "permission requested", Category: "work", Color: "var(--orange)", ColorANSI: 214, DetailANSI: 241},
	"permission.resolve": {Label: "allowed", Category: "work", Color: "var(--green)", ColorANSI: 78, DetailANSI: 241},
	"tool.work":          {Label: "work", Category: "work", Color: "var(--green)", ColorANSI: 78, DetailANSI: 241},

	"worktree.entered": {Label: "entered worktree", Category: "lifecycle", Color: "var(--green)", ColorANSI: 78, DetailANSI: 241},
	"worktree.exited":  {Label: "exited worktree", Category: "lifecycle", Color: "var(--dim)", ColorANSI: 241, DetailANSI: 241},

	"gh.pr.created": {Label: "PR created", Category: "integration", Color: "var(--green)", ColorANSI: 78, DetailANSI: 252},
	"gh.pr.merged":  {Label: "PR merged", Category: "integration", Color: "var(--green)", ColorANSI: 78, DetailANSI: 252},

	"linear.issue.read": {Label: "linear", Category: "integration", Color: "var(--purple)", ColorANSI: 141, DetailANSI: 252},

	"user.prompt": {Label: "user message", Category: "interaction", Color: "var(--blue)", ColorANSI: 111, DetailANSI: 252},

	"context.snapshot": {Label: "context", Category: "context", Color: "var(--dim)", ColorANSI: 241, DetailANSI: 241, Skip: true},

	// Legacy state entries
	"state.working": {Label: "resumed", Category: "lifecycle", Color: "var(--green)", ColorANSI: 78, DetailANSI: 241},
	"state.blocked": {Label: "blocked", Category: "interaction", Color: "var(--orange)", ColorANSI: 214, DetailANSI: 252},
	"state.done":    {Label: "ended", Category: "lifecycle", Color: "var(--dim)", ColorANSI: 241, DetailANSI: 241},
}

// Lookup returns the EventInfo for the given event name.
// Returns a sensible default for unknown events.
func Lookup(event string) EventInfo {
	if info, ok := Catalog[event]; ok {
		return info
	}
	return EventInfo{Label: event, Category: "lifecycle", Color: "var(--dim)", ColorANSI: 241, DetailANSI: 241}
}
