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
	StatusWorking   = "working"
	StatusBlocked   = "blocked"
	StatusPrompting = "prompting"
	StatusPaused    = "paused"
	StatusArchived  = "archived"
)

// IsLive returns true if the status represents a running Claude process.
func IsLive(status string) bool {
	return status == StatusWorking || status == StatusBlocked || status == StatusPrompting
}

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

// ParseName splits a session name into its parts.
// Supports both "project/session" and "project/ticket/session".
func ParseName(name string) (project, ticket, session string, err error) {
	parts := strings.SplitN(name, "/", 3)
	switch len(parts) {
	case 3:
		if parts[0] == "" || parts[1] == "" || parts[2] == "" {
			return "", "", "", fmt.Errorf("session name must be project/session or project/ticket/session, got %q", name)
		}
		return parts[0], parts[1], parts[2], nil
	case 2:
		if parts[0] == "" || parts[1] == "" {
			return "", "", "", fmt.Errorf("session name must be project/session or project/ticket/session, got %q", name)
		}
		return parts[0], "", parts[1], nil
	default:
		return "", "", "", fmt.Errorf("session name must be project/session or project/ticket/session, got %q", name)
	}
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

// FocusedPath returns the path to the global focused-session marker file.
func FocusedPath() string { return filepath.Join(BaseDir(), "focused") }

// WriteFocused writes the given session name to the global focus marker.
func WriteFocused(name string) error {
	return os.WriteFile(FocusedPath(), []byte(name), 0644)
}

// ReadFocused returns the name of the currently focused session, or "".
func ReadFocused() string {
	data, err := os.ReadFile(FocusedPath())
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// WorktreePath returns the path to a session's worktree marker file.
func WorktreePath(name string) string { return filepath.Join(SessionDir(name), "worktree") }

// ReadWorktree returns the worktree branch name if the session is in a worktree.
func ReadWorktree(name string) string {
	data, err := os.ReadFile(WorktreePath(name))
	if err != nil {
		return ""
	}
	return strings.TrimRight(strings.TrimSpace(string(data)), ".")
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

	// Write state.json (the only state file — events go through AppendEvent)
	return os.WriteFile(filepath.Join(dir, "state.json"), append(data, '\n'), 0644)
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
	// Migration compat: treat legacy "done" as "paused"
	if s.Status == "done" {
		s.Status = StatusPaused
	}
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
// Supports both 2-level (project/session) and 3-level (project/ticket/session) layouts.
// A directory with state.json is a session; a directory without it is a ticket group.
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
		entryPath := filepath.Join(dir, name)
		// Check if this entry is a direct session (has state.json)
		if _, err := os.Stat(filepath.Join(entryPath, "state.json")); err == nil {
			fullName := project + "/" + name
			s, err := ReadState(fullName)
			if err != nil {
				continue
			}
			sessions = append(sessions, *s)
			continue
		}
		// Otherwise it might be a ticket group — scan its children
		subEntries, err := os.ReadDir(entryPath)
		if err != nil {
			continue
		}
		for _, sub := range subEntries {
			subName := sub.Name()
			if !sub.IsDir() || subName == "" || subName[0] == '.' {
				continue
			}
			fullName := project + "/" + name + "/" + subName
			s, err := ReadState(fullName)
			if err != nil {
				continue
			}
			sessions = append(sessions, *s)
		}
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
		if IsLive(s.Status) {
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
// Conversations marked with claude.discarded are excluded from results.
func ConversationSegments(name string) []ConversationSegment {
	logPath := filepath.Join(SessionDir(name), "log.jsonl")
	f, err := os.Open(logPath)
	if err != nil {
		return nil
	}
	defer f.Close()

	var segments []ConversationSegment
	var currentIdx int = -1
	discarded := make(map[string]bool)

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
		case "claude.discarded":
			if id := te.MetaClaudeID(); id != "" {
				discarded[id] = true
			}
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

	// Filter out discarded conversations
	if len(discarded) > 0 {
		filtered := segments[:0]
		for _, seg := range segments {
			if !discarded[seg.ClaudeID] {
				filtered = append(filtered, seg)
			}
		}
		segments = filtered
	}

	return segments
}

// DiscardConversation marks a Claude conversation as discarded by appending
// a claude.discarded event. The conversation data remains in the log but
// is excluded from ConversationSegments results.
func DiscardConversation(name, claudeID string) error {
	return AppendEvent(name, "claude.discarded", &schema.ClaudeIDMeta{ClaudeID: claudeID})
}

// SiblingSummaries returns a formatted string of sibling session states.
// For 3-level sessions (project/ticket/session), siblings are scoped to the ticket.
// For 2-level sessions (project/session), siblings are other sessions directly under the project.
func SiblingSummaries(name string) string {
	project, ticket, _, err := ParseName(name)
	if err != nil {
		return ""
	}

	allSessions, err := ListSessionsForProject(project)
	if err != nil {
		return ""
	}

	var lines []string
	for _, s := range allSessions {
		if s.Session == name {
			continue
		}
		// Scope siblings: if we have a ticket, only show sessions under the same ticket.
		// If no ticket, only show other 2-level sessions (no ticket).
		_, sibTicket, _, sibErr := ParseName(s.Session)
		if sibErr != nil {
			continue
		}
		if ticket != sibTicket {
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

// RecoverStaleSessions finds non-done sessions whose PID is no longer alive
// and marks them as done, cleaning up transient files. Returns the names of
// recovered sessions.
func RecoverStaleSessions() []string {
	sessions, err := ListSessions()
	if err != nil {
		return nil
	}

	var recovered []string
	for _, s := range sessions {
		if !IsLive(s.Status) {
			continue
		}
		if IsProcessAlive(s.PID) {
			continue
		}
		// PID is dead — recover this session
		WriteState(s.Session, StatusPaused, "Recovered (stale)", s.PID)
		dir := SessionDir(s.Session)
		os.Remove(filepath.Join(dir, "pending"))
		os.Remove(filepath.Join(dir, "wave-block-id"))
		os.Remove(WorktreePath(s.Session))
		CleanupPID(s.PID)
		recovered = append(recovered, s.Session)
	}
	return recovered
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
