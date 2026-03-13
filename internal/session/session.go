package session

import (
	"bufio"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/uiid-systems/bertrand/internal/schema"
)

// Status constants for session state.
const (
	StatusWorking = "working"
	StatusBlocked = "blocked"
	StatusDone    = "done"
)

func BaseDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.Getenv("HOME")
	}
	return filepath.Join(home, ".bertrand")
}

func SessionsDir() string  { return filepath.Join(BaseDir(), "sessions") }
func ContractPath() string { return filepath.Join(BaseDir(), "contract.md") }

// SessionDir returns the filesystem path for a session. The name can be either
// "project/session" (new hierarchical format) or a flat name (legacy).
// filepath.Join handles both cases naturally.
func SessionDir(name string) string { return filepath.Join(SessionsDir(), name) }

// ParseName splits a "project/session" name into its parts.
// Splits on the first "/" only, so "a/b/c" parses as project="a", session="b/c".
// Returns an error if the name doesn't contain at least one slash.
func ParseName(name string) (project, session string, err error) {
	parts := strings.SplitN(name, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("session name must be project/session, got %q", name)
	}
	return parts[0], parts[1], nil
}

// SummaryPath returns the path to a session's exit summary hint file.
func SummaryPath(name string) string { return filepath.Join(SessionDir(name), "summary") }

// DiscardPath returns the path to a session's discard marker hint file.
func DiscardPath(name string) string { return filepath.Join(SessionDir(name), "discard") }

// ReadSummary returns the session exit summary if one was written by the hook.
func ReadSummary(name string) string {
	data, err := os.ReadFile(SummaryPath(name))
	if err != nil {
		return ""
	}
	return string(data)
}

// WorktreePath returns the path to a session's worktree marker file.
func WorktreePath(name string) string { return filepath.Join(SessionDir(name), "worktree") }

// ReadWorktree returns the worktree branch name if the session is in a worktree.
func ReadWorktree(name string) string {
	data, err := os.ReadFile(WorktreePath(name))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

type State struct {
	Session   string    `json:"session"`
	Status    string    `json:"status"`
	Summary   string    `json:"summary"`
	PID       int       `json:"pid"`
	Timestamp time.Time `json:"timestamp"`
}

// AppendEvent writes a typed event to both the per-session and global log.
// The meta parameter should be a typed struct from the schema package
// (e.g., *schema.SessionStartedMeta, *schema.ClaudeIDMeta).
func AppendEvent(name, event string, meta any) error {
	ev, err := schema.NewEvent(event, name, meta)
	if err != nil {
		return err
	}
	line, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	line = append(line, '\n')

	// Per-session log
	dir := SessionDir(name)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	if err := appendFile(filepath.Join(dir, "log.jsonl"), line); err != nil {
		return err
	}

	// Global log
	globalDir := BaseDir()
	return appendFile(filepath.Join(globalDir, "log.jsonl"), line)
}

func appendFile(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(data)
	return err
}

func WriteState(name, status, summary string, pid int) error {
	dir := SessionDir(name)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	s := State{
		Session:   name,
		Status:    status,
		Summary:   summary,
		PID:       pid,
		Timestamp: time.Now().UTC(),
	}

	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}

	// Write state.json
	if err := os.WriteFile(filepath.Join(dir, "state.json"), append(data, '\n'), 0644); err != nil {
		return err
	}

	// Append to log.jsonl
	line, _ := json.Marshal(s)
	f, err := os.OpenFile(filepath.Join(dir, "log.jsonl"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = fmt.Fprintf(f, "%s\n", line)
	return err
}

func ReadState(name string) (*State, error) {
	data, err := os.ReadFile(filepath.Join(SessionDir(name), "state.json"))
	if err != nil {
		return nil, err
	}
	var s State
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, err
	}
	// Normalize: path-derived name is always authoritative
	s.Session = name
	return &s, nil
}

// ListSessions returns all sessions across all projects (two-level walk).
func ListSessions() ([]State, error) {
	projects, err := ListProjects()
	if err != nil {
		return nil, err
	}

	var sessions []State
	for _, project := range projects {
		projectSessions, err := ListSessionsForProject(project)
		if err != nil {
			continue
		}
		sessions = append(sessions, projectSessions...)
	}
	return sessions, nil
}

// ListProjects returns the names of all project directories under sessions/.
func ListProjects() ([]string, error) {
	dir := SessionsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var projects []string
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() || name == "" || name[0] == '.' {
			continue
		}
		projects = append(projects, name)
	}
	return projects, nil
}

// ListSessionsForProject returns all sessions within a given project.
func ListSessionsForProject(project string) ([]State, error) {
	dir := filepath.Join(SessionsDir(), project)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var sessions []State
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() || name == "" || name[0] == '.' {
			continue
		}
		fullName := project + "/" + name
		s, err := ReadState(fullName)
		if err != nil {
			continue
		}
		sessions = append(sessions, *s)
	}
	return sessions, nil
}

func DeleteSession(name string) error {
	return os.RemoveAll(SessionDir(name))
}

func ActiveSessions() ([]State, error) {
	all, err := ListSessions()
	if err != nil {
		return nil, err
	}
	var active []State
	for _, s := range all {
		if s.Status != StatusDone {
			active = append(active, s)
		}
	}
	return active, nil
}

// IsProcessAlive checks if a PID is still running.
func IsProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = proc.Signal(syscall.Signal(0))
	return err == nil
}

// RegisterPID writes a PID-to-session mapping so hooks can look up the session name.
func RegisterPID(pid int, sessionName string) error {
	dir := filepath.Join(BaseDir(), "tmp")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, fmt.Sprintf("%d", pid)), []byte(sessionName), 0644)
}

// LookupPID returns the session name for a given PID.
func LookupPID(pid int) (string, error) {
	data, err := os.ReadFile(filepath.Join(BaseDir(), "tmp", fmt.Sprintf("%d", pid)))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// CleanupPID removes the PID mapping file.
func CleanupPID(pid int) {
	os.Remove(filepath.Join(BaseDir(), "tmp", fmt.Sprintf("%d", pid)))
}

// NewClaudeID generates a UUID v4 for tracking Claude conversation segments.
func NewClaudeID() string {
	var uuid [16]byte
	rand.Read(uuid[:])
	uuid[6] = (uuid[6] & 0x0f) | 0x40 // version 4
	uuid[8] = (uuid[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		uuid[0:4], uuid[4:6], uuid[6:8], uuid[8:10], uuid[10:16])
}

// ConversationSegment represents a single Claude conversation within a bertrand session.
type ConversationSegment struct {
	ClaudeID    string
	StartedAt   time.Time
	EndedAt     time.Time
	LastQuestion string
	EventCount  int
}

// ConversationSegments parses log.jsonl to find distinct Claude conversation segments.
// Events between claude.started and claude.ended are attributed to that conversation.
// Events from hooks (like session.block) don't carry claude_id, so we track the
// "current" conversation and attribute interleaved events to it.
func ConversationSegments(name string) []ConversationSegment {
	logPath := filepath.Join(SessionDir(name), "log.jsonl")
	f, err := os.Open(logPath)
	if err != nil {
		return nil
	}
	defer f.Close()

	var segments []ConversationSegment
	var currentIdx int = -1

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		te, err := schema.ParseEvent(scanner.Bytes())
		if err != nil {
			continue
		}

		switch te.Event {
		case "claude.started":
			claudeID := te.MetaClaudeID()
			if claudeID == "" {
				continue
			}
			currentIdx = len(segments)
			segments = append(segments, ConversationSegment{
				ClaudeID:  claudeID,
				StartedAt: te.TS,
			})
		case "claude.ended":
			if currentIdx >= 0 && currentIdx < len(segments) {
				segments[currentIdx].EndedAt = te.TS
			}
			currentIdx = -1
		default:
			if currentIdx >= 0 && currentIdx < len(segments) {
				segments[currentIdx].EventCount++
				segments[currentIdx].EndedAt = te.TS
				if te.Event == "session.block" {
					if m, ok := te.TypedMeta.(*schema.SessionBlockMeta); ok {
						segments[currentIdx].LastQuestion = m.Question
					}
				}
			}
		}
	}

	return segments
}

// LogDigest reads log.jsonl and returns a compact timeline string for contract injection.
func LogDigest(name string) string {
	logPath := filepath.Join(SessionDir(name), "log.jsonl")
	f, err := os.Open(logPath)
	if err != nil {
		return ""
	}
	defer f.Close()

	var lines []string
	var firstTS, lastTS time.Time
	eventCount := 0

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		te, err := schema.ParseEvent(scanner.Bytes())
		if err != nil {
			continue
		}

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
		case "context.snapshot":
			// Skip context snapshots in digest — too noisy
		}
	}

	if len(lines) == 0 {
		return ""
	}

	duration := lastTS.Sub(firstTS).Round(time.Second)
	header := fmt.Sprintf("## Session Timeline (%d events, %s)", eventCount, duration)

	return header + "\n" + strings.Join(lines, "\n")
}

// SiblingSummaries returns a formatted string of sibling session states
// within the same project, excluding the given session.
func SiblingSummaries(name string) string {
	project, _, err := ParseName(name)
	if err != nil {
		return ""
	}

	siblings, err := ListSessionsForProject(project)
	if err != nil {
		return ""
	}

	var lines []string
	for _, s := range siblings {
		if s.Session == name {
			continue
		}
		summary := s.Summary
		if len(summary) > 60 {
			summary = summary[:57] + "..."
		}
		wt := ReadWorktree(s.Session)
		if wt != "" {
			lines = append(lines, fmt.Sprintf("- %s: %s (worktree: %s) — %q", s.Session, s.Status, wt, summary))
		} else {
			lines = append(lines, fmt.Sprintf("- %s: %s — %q", s.Session, s.Status, summary))
		}
	}

	if len(lines) == 0 {
		return ""
	}

	return "## Sibling Sessions\n" + strings.Join(lines, "\n")
}

// MigrateFlatSessions moves any flat (non-hierarchical) sessions into a
// "legacy" project directory. Returns the number of sessions migrated.
func MigrateFlatSessions() (int, error) {
	dir := SessionsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}

	migrated := 0
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() || name == "" || name[0] == '.' {
			continue
		}
		// A flat session has state.json directly inside it
		statePath := filepath.Join(dir, name, "state.json")
		if _, err := os.Stat(statePath); err != nil {
			continue // not a session dir
		}
		// Check it's not already a project dir (would have subdirs with state.json)
		subEntries, err := os.ReadDir(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		isProject := false
		for _, sub := range subEntries {
			if sub.IsDir() {
				subState := filepath.Join(dir, name, sub.Name(), "state.json")
				if _, err := os.Stat(subState); err == nil {
					isProject = true
					break
				}
			}
		}
		if isProject {
			continue
		}
		// Move to legacy/<name>
		legacyDir := filepath.Join(dir, "legacy")
		if err := os.MkdirAll(legacyDir, 0755); err != nil {
			return migrated, err
		}
		dst := filepath.Join(legacyDir, name)
		if err := os.Rename(filepath.Join(dir, name), dst); err != nil {
			// Skip if destination already exists (prior partial migration)
			if os.IsExist(err) {
				continue
			}
			return migrated, err
		}
		migrated++
	}
	return migrated, nil
}
