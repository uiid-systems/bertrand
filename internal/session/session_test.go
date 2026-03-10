package session

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// withTempBaseDir overrides BaseDir for tests and returns a cleanup function.
func withTempBaseDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	origHome := os.Getenv("HOME")
	// Point HOME to a temp dir so BaseDir() resolves there
	t.Setenv("HOME", dir)
	t.Cleanup(func() { os.Setenv("HOME", origHome) })
	// Pre-create the sessions and tmp dirs
	os.MkdirAll(filepath.Join(dir, ".bertrand", "sessions"), 0755)
	os.MkdirAll(filepath.Join(dir, ".bertrand", "tmp"), 0755)
	return filepath.Join(dir, ".bertrand")
}

func TestWriteAndReadState(t *testing.T) {
	base := withTempBaseDir(t)

	err := WriteState("test-session", StatusWorking, "doing stuff", 1234)
	if err != nil {
		t.Fatalf("WriteState: %v", err)
	}

	s, err := ReadState("test-session")
	if err != nil {
		t.Fatalf("ReadState: %v", err)
	}

	if s.Session != "test-session" {
		t.Errorf("Session = %q, want %q", s.Session, "test-session")
	}
	if s.Status != StatusWorking {
		t.Errorf("Status = %q, want %q", s.Status, StatusWorking)
	}
	if s.Summary != "doing stuff" {
		t.Errorf("Summary = %q, want %q", s.Summary, "doing stuff")
	}
	if s.PID != 1234 {
		t.Errorf("PID = %d, want %d", s.PID, 1234)
	}

	// Verify log.jsonl was also written
	logPath := filepath.Join(base, "sessions", "test-session", "log.jsonl")
	logData, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("reading log.jsonl: %v", err)
	}
	var logEntry State
	if err := json.Unmarshal(logData[:len(logData)-1], &logEntry); err != nil {
		t.Fatalf("parsing log.jsonl: %v", err)
	}
	if logEntry.Session != "test-session" {
		t.Errorf("log entry Session = %q, want %q", logEntry.Session, "test-session")
	}
}

func TestReadState_NotFound(t *testing.T) {
	withTempBaseDir(t)

	_, err := ReadState("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestListSessions(t *testing.T) {
	withTempBaseDir(t)

	// Empty
	sessions, err := ListSessions()
	if err != nil {
		t.Fatalf("ListSessions empty: %v", err)
	}
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(sessions))
	}

	// Create some sessions
	WriteState("alpha", StatusWorking, "a", 1)
	WriteState("beta", StatusBlocked, "b", 2)
	WriteState("gamma", StatusDone, "c", 3)

	sessions, err = ListSessions()
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 3 {
		t.Fatalf("expected 3 sessions, got %d", len(sessions))
	}
}

func TestActiveSessions(t *testing.T) {
	withTempBaseDir(t)

	WriteState("active-1", StatusWorking, "a", 1)
	WriteState("active-2", StatusBlocked, "b", 2)
	WriteState("finished", StatusDone, "c", 3)

	active, err := ActiveSessions()
	if err != nil {
		t.Fatalf("ActiveSessions: %v", err)
	}
	if len(active) != 2 {
		t.Errorf("expected 2 active sessions, got %d", len(active))
	}
	for _, s := range active {
		if s.Status == StatusDone {
			t.Error("ActiveSessions returned a done session")
		}
	}
}

func TestDeleteSession(t *testing.T) {
	withTempBaseDir(t)

	WriteState("to-delete", StatusDone, "bye", 1)

	if err := DeleteSession("to-delete"); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}

	_, err := ReadState("to-delete")
	if err == nil {
		t.Error("expected error after deletion")
	}
}

func TestRegisterAndLookupPID(t *testing.T) {
	withTempBaseDir(t)

	if err := RegisterPID(9999, "pid-session"); err != nil {
		t.Fatalf("RegisterPID: %v", err)
	}

	name, err := LookupPID(9999)
	if err != nil {
		t.Fatalf("LookupPID: %v", err)
	}
	if name != "pid-session" {
		t.Errorf("LookupPID = %q, want %q", name, "pid-session")
	}

	CleanupPID(9999)

	_, err = LookupPID(9999)
	if err == nil {
		t.Error("expected error after CleanupPID")
	}
}

func TestIsProcessAlive(t *testing.T) {
	if IsProcessAlive(0) {
		t.Error("PID 0 should not be alive")
	}
	if IsProcessAlive(-1) {
		t.Error("PID -1 should not be alive")
	}
	// Current process should be alive
	if !IsProcessAlive(os.Getpid()) {
		t.Error("current process should be alive")
	}
}

func TestSummaryAndDiscardPaths(t *testing.T) {
	withTempBaseDir(t)

	// Verify paths point to the right locations
	sp := SummaryPath("my-session")
	if filepath.Base(sp) != "summary" {
		t.Errorf("SummaryPath base = %q, want %q", filepath.Base(sp), "summary")
	}
	dp := DiscardPath("my-session")
	if filepath.Base(dp) != "discard" {
		t.Errorf("DiscardPath base = %q, want %q", filepath.Base(dp), "discard")
	}
}

func TestReadSummary(t *testing.T) {
	withTempBaseDir(t)

	// No summary file → empty string
	if s := ReadSummary("no-summary"); s != "" {
		t.Errorf("ReadSummary with no file = %q, want empty", s)
	}

	// Write a summary file
	WriteState("with-summary", StatusWorking, "working", 1)
	os.WriteFile(SummaryPath("with-summary"), []byte("Implemented auth, TODO: tests"), 0644)

	if s := ReadSummary("with-summary"); s != "Implemented auth, TODO: tests" {
		t.Errorf("ReadSummary = %q, want %q", s, "Implemented auth, TODO: tests")
	}
}

func TestListSessions_SkipsHiddenAndFiles(t *testing.T) {
	base := withTempBaseDir(t)

	// Create a hidden dir and a regular file — both should be skipped
	os.MkdirAll(filepath.Join(base, "sessions", ".hidden"), 0755)
	os.WriteFile(filepath.Join(base, "sessions", "not-a-dir"), []byte("x"), 0644)

	WriteState("real-session", StatusWorking, "ok", 1)

	sessions, err := ListSessions()
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Errorf("expected 1 session, got %d", len(sessions))
	}
	if sessions[0].Session != "real-session" {
		t.Errorf("expected real-session, got %q", sessions[0].Session)
	}
}
