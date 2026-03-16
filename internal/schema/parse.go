package schema

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

// ParseEvent parses a single JSON line from log.jsonl into a TypedEvent.
// It handles three formats:
//   - v1 events: {"v":1, "event":"...", ...}
//   - v0 events: {"event":"...", ...} (no version field, same meta shapes)
//   - Legacy State: {"session":"...", "status":"...", "summary":"...", "pid":N, "timestamp":"..."}
func ParseEvent(line []byte) (*TypedEvent, error) {
	// Probe for format: check if "event" key exists.
	var probe struct {
		Event  string `json:"event"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(line, &probe); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	if probe.Event != "" {
		return parseLogEvent(line)
	}
	if probe.Status != "" {
		return parseLegacyState(line)
	}
	return nil, fmt.Errorf("unrecognized log entry: no event or status field")
}

// parseLogEvent handles v0 and v1 LogEvent entries.
func parseLogEvent(line []byte) (*TypedEvent, error) {
	var env Event
	if err := json.Unmarshal(line, &env); err != nil {
		return nil, fmt.Errorf("unmarshal envelope: %w", err)
	}

	te := &TypedEvent{
		V:       env.V,
		Event:   env.Event,
		Session: env.Session,
		TS:      env.TS,
	}

	var err error
	te.TypedMeta, err = parseMeta(env.Event, env.Meta)
	if err != nil {
		// Non-fatal: store nil meta but keep the event.
		te.TypedMeta = nil
	}

	return te, nil
}

// parseMeta unmarshals the meta field into the correct typed struct
// based on the event discriminator.
func parseMeta(event string, raw json.RawMessage) (any, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}

	switch event {
	case "session.started":
		var m SessionStartedMeta
		return &m, json.Unmarshal(raw, &m)
	case "session.resumed":
		var m SessionResumedMeta
		return &m, json.Unmarshal(raw, &m)
	case "session.end":
		var m SessionEndMeta
		return &m, json.Unmarshal(raw, &m)
	case "claude.started", "claude.ended", "claude.discarded", "session.resume", "worktree.exited":
		var m ClaudeIDMeta
		return &m, json.Unmarshal(raw, &m)
	case "session.block":
		var m SessionBlockMeta
		return &m, json.Unmarshal(raw, &m)
	case "permission.request", "permission.resolve":
		var m PermissionMeta
		return &m, json.Unmarshal(raw, &m)
	case "worktree.entered":
		var m WorktreeEnteredMeta
		return &m, json.Unmarshal(raw, &m)
	case "gh.pr.created":
		var m GhPrCreatedMeta
		return &m, json.Unmarshal(raw, &m)
	case "gh.pr.merged":
		var m GhPrMergedMeta
		return &m, json.Unmarshal(raw, &m)
	case "linear.issue.read":
		var m LinearIssueReadMeta
		return &m, json.Unmarshal(raw, &m)
	case "context.snapshot":
		var m ContextSnapshotMeta
		return &m, json.Unmarshal(raw, &m)
	default:
		// Unknown event type — preserve raw meta as map for forward compat.
		var m map[string]string
		if err := json.Unmarshal(raw, &m); err != nil {
			return nil, err
		}
		return m, nil
	}
}

// legacyState matches the old State struct format written by WriteState().
type legacyState struct {
	Session   string    `json:"session"`
	Status    string    `json:"status"`
	Summary   string    `json:"summary"`
	PID       int       `json:"pid"`
	Timestamp time.Time `json:"timestamp"`
}

// parseLegacyState converts a legacy State JSON entry into a synthetic TypedEvent.
// The event name becomes "state.{status}" (e.g., "state.working", "state.blocked").
func parseLegacyState(line []byte) (*TypedEvent, error) {
	var s legacyState
	if err := json.Unmarshal(line, &s); err != nil {
		return nil, fmt.Errorf("unmarshal legacy state: %w", err)
	}

	pidStr := ""
	if s.PID > 0 {
		pidStr = strconv.Itoa(s.PID)
	}

	return &TypedEvent{
		V:       0,
		Event:   "state." + s.Status,
		Session: s.Session,
		TS:      s.Timestamp,
		TypedMeta: &LegacyStateMeta{
			Summary: s.Summary,
			PID:     pidStr,
		},
	}, nil
}

// MetaClaudeID extracts the claude_id from a TypedEvent's metadata, if present.
func (te *TypedEvent) MetaClaudeID() string {
	switch m := te.TypedMeta.(type) {
	case *ClaudeIDMeta:
		return m.ClaudeID
	case *SessionBlockMeta:
		return m.ClaudeID
	case *PermissionMeta:
		return m.ClaudeID
	case *WorktreeEnteredMeta:
		return m.ClaudeID
	case *GhPrCreatedMeta:
		return m.ClaudeID
	case *GhPrMergedMeta:
		return m.ClaudeID
	case *LinearIssueReadMeta:
		return m.ClaudeID
	case *ContextSnapshotMeta:
		return m.ClaudeID
	case map[string]string:
		return m["claude_id"]
	default:
		return ""
	}
}

// MetaSummary extracts a human-readable summary from a TypedEvent's metadata.
// Used for display in timelines and digests.
func (te *TypedEvent) MetaSummary() string {
	switch m := te.TypedMeta.(type) {
	case *SessionBlockMeta:
		return m.Question
	case *SessionEndMeta:
		return m.Summary
	case *PermissionMeta:
		return m.Tool
	case *WorktreeEnteredMeta:
		return m.Branch
	case *GhPrCreatedMeta:
		if m.PRURL != "" {
			return m.PRURL
		}
		return m.PRNumber
	case *GhPrMergedMeta:
		return m.PRNumber
	case *LinearIssueReadMeta:
		if m.IssueTitle != "" {
			return m.IssueID + ": " + m.IssueTitle
		}
		return m.IssueID
	case *ContextSnapshotMeta:
		return m.Model + " " + m.RemainingPct + "%"
	case *ClaudeIDMeta:
		cid := m.ClaudeID
		if len(cid) > 8 {
			cid = cid[:8]
		}
		return cid
	case *LegacyStateMeta:
		return m.Summary
	default:
		return ""
	}
}
