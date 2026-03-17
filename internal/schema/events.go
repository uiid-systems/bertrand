package schema

import (
	"encoding/json"
	"time"
)

// Version is the current schema version for new events.
const Version = 1

// Event is the wire format envelope for all log events.
// The Meta field is deferred (json.RawMessage) to allow two-phase parsing:
// first unmarshal the envelope to read the event discriminator, then
// unmarshal meta into the correct typed struct.
type Event struct {
	V       int             `json:"v,omitempty"`
	Event   string          `json:"event"`
	Session string          `json:"session"`
	TS      time.Time       `json:"ts"`
	Meta    json.RawMessage `json:"meta,omitempty"`
}

// TypedEvent pairs the raw envelope with its parsed, typed metadata.
type TypedEvent struct {
	V         int
	Event     string
	Session   string
	TS        time.Time
	TypedMeta any // one of *SessionStartedMeta, *ClaudeIDMeta, etc.
}

// NewEvent creates an Event with the current schema version.
func NewEvent(event, session string, meta any) (*Event, error) {
	raw, err := json.Marshal(meta)
	if err != nil {
		return nil, err
	}
	return &Event{
		V:       Version,
		Event:   event,
		Session: session,
		TS:      time.Now().UTC(),
		Meta:    raw,
	}, nil
}

// --- Per-event metadata structs ---

// SessionStartedMeta is metadata for session.started events.
type SessionStartedMeta struct {
	PID string `json:"pid"`
}

// SessionResumedMeta is metadata for session.resumed events.
type SessionResumedMeta struct {
	PID string `json:"pid"`
}

// SessionEndMeta is metadata for session.end events.
type SessionEndMeta struct {
	Summary string `json:"summary"`
}

// ClaudeIDMeta is shared metadata for events that only carry a claude_id.
// Used by: claude.started, claude.ended, worktree.exited.
type ClaudeIDMeta struct {
	ClaudeID string `json:"claude_id"`
}

// SessionUserResumeMeta is metadata for session.resume events (user responded).
type SessionUserResumeMeta struct {
	Answer   string `json:"answer,omitempty"`
	ClaudeID string `json:"claude_id"`
}

// SessionBlockMeta is metadata for session.block events.
type SessionBlockMeta struct {
	Question string `json:"question"`
	ClaudeID string `json:"claude_id"`
}

// PermissionMeta is metadata for permission.request and permission.resolve events.
type PermissionMeta struct {
	Tool     string `json:"tool"`
	ClaudeID string `json:"claude_id"`
}

// WorktreeEnteredMeta is metadata for worktree.entered events.
type WorktreeEnteredMeta struct {
	Branch   string `json:"branch"`
	ClaudeID string `json:"claude_id"`
}

// GhPrCreatedMeta is metadata for gh.pr.created events.
type GhPrCreatedMeta struct {
	PRNumber string `json:"pr_number,omitempty"`
	PRURL    string `json:"pr_url,omitempty"`
	Branch   string `json:"branch,omitempty"`
	ClaudeID string `json:"claude_id"`
}

// GhPrMergedMeta is metadata for gh.pr.merged events.
type GhPrMergedMeta struct {
	PRNumber string `json:"pr_number,omitempty"`
	Branch   string `json:"branch,omitempty"`
	ClaudeID string `json:"claude_id"`
}

// LinearIssueReadMeta is metadata for linear.issue.read events.
type LinearIssueReadMeta struct {
	IssueID    string `json:"issue_id,omitempty"`
	IssueTitle string `json:"issue_title,omitempty"`
	ToolName   string `json:"tool_name,omitempty"`
	ClaudeID   string `json:"claude_id"`
}

// ContextSnapshotMeta is metadata for context.snapshot events.
type ContextSnapshotMeta struct {
	Model               string `json:"model"`
	InputTokens         string `json:"input_tokens,omitempty"`
	CacheCreationTokens string `json:"cache_creation_tokens,omitempty"`
	CacheReadTokens     string `json:"cache_read_tokens,omitempty"`
	ContextWindowSize   string `json:"context_window_size,omitempty"`
	RemainingPct        string `json:"remaining_pct,omitempty"`
	ClaudeID            string `json:"claude_id"`
}

// LegacyStateMeta is metadata synthesized from legacy State entries
// (entries with "status" but no "event" field).
type LegacyStateMeta struct {
	Summary string `json:"summary"`
	PID     string `json:"pid,omitempty"`
}

// EventNames enumerates all known event types.
var EventNames = []string{
	"session.started",
	"session.resumed",
	"session.end",
	"claude.started",
	"claude.ended",
	"session.block",
	"session.resume",
	"permission.request",
	"permission.resolve",
	"worktree.entered",
	"worktree.exited",
	"gh.pr.created",
	"gh.pr.merged",
	"linear.issue.read",
	"context.snapshot",
	"claude.discarded",
}
