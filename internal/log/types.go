package log

import (
	"time"

	"github.com/uiid-systems/bertrand/internal/schema"
)

// EnrichedEvent is a log event with all display data pre-computed.
type EnrichedEvent struct {
	Event    string    `json:"event"`
	Session  string    `json:"session"`
	TS       time.Time `json:"ts"`
	Summary  string    `json:"summary"`
	Label    string    `json:"label"`
	Category string    `json:"category"`
	Color    string    `json:"color"`
	Meta     any       `json:"meta,omitempty"`
}

// TimingBreakdown is the JSON-friendly timing summary.
type TimingBreakdown struct {
	ClaudeWorkS int `json:"claude_work_s"`
	UserWaitS   int `json:"user_wait_s"`
	ActivePct   int `json:"active_pct"`
}

// SessionDigest is the full enriched response shape for a session.
type SessionDigest struct {
	Session       string          `json:"session"`
	StartedAt     time.Time       `json:"started_at"`
	EndedAt       time.Time       `json:"ended_at"`
	DurationS     int             `json:"duration_s"`
	EventCount    int             `json:"event_count"`
	Interactions  int             `json:"interactions"`
	Conversations int             `json:"conversations"`
	PRs           int             `json:"prs"`
	Timing        TimingBreakdown `json:"timing"`
	Timeline      []EnrichedEvent `json:"timeline"`
	Events        []EnrichedEvent `json:"events,omitempty"`

	// Chart-ready
	ActivityByHour    map[int]int    `json:"activity_by_hour"`
	EventDistribution map[string]int `json:"event_distribution"`
	TimeDistribution  map[string]int `json:"time_distribution"`

	// TimingRaw is the full timing summary for callers that need duration values.
	// Excluded from JSON (use Timing for serialized output).
	TimingRaw *schema.TimingSummary `json:"-"`
}
