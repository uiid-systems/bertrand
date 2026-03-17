package session

import (
	"os"
	"path/filepath"
	"strings"
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
	withTempBaseDir(t)

	err := WriteState("proj/test-session", StatusWorking, "doing stuff", 1234)
	if err != nil {
		t.Fatalf("WriteState: %v", err)
	}

	s, err := ReadState("proj/test-session")
	if err != nil {
		t.Fatalf("ReadState: %v", err)
	}

	if s.Session != "proj/test-session" {
		t.Errorf("Session = %q, want %q", s.Session, "proj/test-session")
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
}

func TestReadState_NotFound(t *testing.T) {
	withTempBaseDir(t)

	_, err := ReadState("proj/nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestReadState_NormalizesLegacyName(t *testing.T) {
	base := withTempBaseDir(t)

	// Simulate a migrated session with old flat name in state.json
	dir := filepath.Join(base, "sessions", "legacy", "old-session")
	os.MkdirAll(dir, 0755)
	state := `{"session":"old-session","status":"done","summary":"old","pid":1}`
	os.WriteFile(filepath.Join(dir, "state.json"), []byte(state), 0644)

	s, err := ReadState("legacy/old-session")
	if err != nil {
		t.Fatalf("ReadState: %v", err)
	}
	// Should be normalized to include project prefix
	if s.Session != "legacy/old-session" {
		t.Errorf("Session = %q, want %q", s.Session, "legacy/old-session")
	}
}

func TestReadState_NormalizesStaleHierarchicalName(t *testing.T) {
	base := withTempBaseDir(t)

	// Simulate a session whose state.json has a stale hierarchical name
	// (e.g., after renaming the project directory)
	dir := filepath.Join(base, "sessions", "new-proj", "my-session")
	os.MkdirAll(dir, 0755)
	state := `{"session":"old-proj/my-session","status":"working","summary":"ok","pid":1}`
	os.WriteFile(filepath.Join(dir, "state.json"), []byte(state), 0644)

	s, err := ReadState("new-proj/my-session")
	if err != nil {
		t.Fatalf("ReadState: %v", err)
	}
	// Should use the path-derived name, not the stale one from the file
	if s.Session != "new-proj/my-session" {
		t.Errorf("Session = %q, want %q", s.Session, "new-proj/my-session")
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

	// Create sessions under projects
	WriteState("proj/alpha", StatusWorking, "a", 1)
	WriteState("proj/beta", StatusBlocked, "b", 2)
	WriteState("other/gamma", StatusPaused, "c", 3)

	sessions, err = ListSessions()
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 3 {
		t.Fatalf("expected 3 sessions, got %d", len(sessions))
	}
}

func TestListProjects(t *testing.T) {
	withTempBaseDir(t)

	WriteState("proj-a/sess-1", StatusWorking, "a", 1)
	WriteState("proj-b/sess-2", StatusWorking, "b", 2)

	projects, err := ListProjects()
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	if len(projects) != 2 {
		t.Errorf("expected 2 projects, got %d", len(projects))
	}
}

func TestListSessionsForProject(t *testing.T) {
	withTempBaseDir(t)

	WriteState("proj/alpha", StatusWorking, "a", 1)
	WriteState("proj/beta", StatusBlocked, "b", 2)
	WriteState("other/gamma", StatusPaused, "c", 3)

	sessions, err := ListSessionsForProject("proj")
	if err != nil {
		t.Fatalf("ListSessionsForProject: %v", err)
	}
	if len(sessions) != 2 {
		t.Errorf("expected 2 sessions for proj, got %d", len(sessions))
	}
}

func TestListSessionsForProject_ThreeLevel(t *testing.T) {
	withTempBaseDir(t)

	// 3-level sessions under a ticket
	WriteState("proj/elky-49/taxonomy", StatusWorking, "a", 1)
	WriteState("proj/elky-49/code-review", StatusPaused, "b", 2)
	// 2-level session directly under project
	WriteState("proj/triage", StatusPaused, "c", 3)

	sessions, err := ListSessionsForProject("proj")
	if err != nil {
		t.Fatalf("ListSessionsForProject: %v", err)
	}
	if len(sessions) != 3 {
		t.Fatalf("expected 3 sessions, got %d", len(sessions))
	}

	// Check all names are present
	names := map[string]bool{}
	for _, s := range sessions {
		names[s.Session] = true
	}
	for _, want := range []string{"proj/elky-49/taxonomy", "proj/elky-49/code-review", "proj/triage"} {
		if !names[want] {
			t.Errorf("expected session %q in results", want)
		}
	}
}

func TestListSessions_MixedDepths(t *testing.T) {
	withTempBaseDir(t)

	WriteState("proj/triage", StatusPaused, "a", 1)
	WriteState("proj/elky-49/taxonomy", StatusWorking, "b", 2)
	WriteState("other/gamma", StatusPaused, "c", 3)

	sessions, err := ListSessions()
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 3 {
		t.Fatalf("expected 3 sessions, got %d", len(sessions))
	}
}

func TestSiblingSummaries_TicketScoped(t *testing.T) {
	withTempBaseDir(t)

	WriteState("proj/elky-49/taxonomy", StatusWorking, "doing taxonomy", 1)
	WriteState("proj/elky-49/code-review", StatusPaused, "reviewed", 2)
	WriteState("proj/triage", StatusPaused, "triaged", 3)

	// Siblings of a ticket session should only include same-ticket sessions
	result := SiblingSummaries("proj/elky-49/taxonomy")
	if result == "" {
		t.Fatal("expected non-empty siblings")
	}
	if !strings.Contains(result, "code-review") {
		t.Error("expected code-review in siblings")
	}
	if strings.Contains(result, "triage") {
		t.Error("did not expect triage in ticket-scoped siblings")
	}

	// Siblings of a direct session should only include other direct sessions
	result2 := SiblingSummaries("proj/triage")
	if strings.Contains(result2, "taxonomy") {
		t.Error("did not expect taxonomy in direct session siblings")
	}
}

func TestActiveSessions(t *testing.T) {
	withTempBaseDir(t)

	WriteState("proj/active-1", StatusWorking, "a", 1)
	WriteState("proj/active-2", StatusBlocked, "b", 2)
	WriteState("proj/finished", StatusPaused, "c", 3)

	active, err := ActiveSessions()
	if err != nil {
		t.Fatalf("ActiveSessions: %v", err)
	}
	if len(active) != 2 {
		t.Errorf("expected 2 active sessions, got %d", len(active))
	}
	for _, s := range active {
		if s.Status == StatusPaused {
			t.Error("ActiveSessions returned a done session")
		}
	}
}

func TestDeleteSession(t *testing.T) {
	withTempBaseDir(t)

	WriteState("proj/to-delete", StatusPaused, "bye", 1)

	if err := DeleteSession("proj/to-delete"); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}

	_, err := ReadState("proj/to-delete")
	if err == nil {
		t.Error("expected error after deletion")
	}
}

func TestRegisterAndLookupPID(t *testing.T) {
	withTempBaseDir(t)

	if err := RegisterPID(9999, "proj/pid-session"); err != nil {
		t.Fatalf("RegisterPID: %v", err)
	}

	name, err := LookupPID(9999)
	if err != nil {
		t.Fatalf("LookupPID: %v", err)
	}
	if name != "proj/pid-session" {
		t.Errorf("LookupPID = %q, want %q", name, "proj/pid-session")
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

	sp := SummaryPath("proj/my-session")
	if filepath.Base(sp) != "summary" {
		t.Errorf("SummaryPath base = %q, want %q", filepath.Base(sp), "summary")
	}
	dp := DiscardPath("proj/my-session")
	if filepath.Base(dp) != "discard" {
		t.Errorf("DiscardPath base = %q, want %q", filepath.Base(dp), "discard")
	}
}

func TestReadSummary(t *testing.T) {
	withTempBaseDir(t)

	// No summary file → empty string
	if s := ReadSummary("proj/no-summary"); s != "" {
		t.Errorf("ReadSummary with no file = %q, want empty", s)
	}

	// Write a summary file
	WriteState("proj/with-summary", StatusWorking, "working", 1)
	os.WriteFile(SummaryPath("proj/with-summary"), []byte("Implemented auth, TODO: tests"), 0644)

	if s := ReadSummary("proj/with-summary"); s != "Implemented auth, TODO: tests" {
		t.Errorf("ReadSummary = %q, want %q", s, "Implemented auth, TODO: tests")
	}
}

func TestListSessions_SkipsHiddenAndFiles(t *testing.T) {
	base := withTempBaseDir(t)

	// Create a hidden dir and a regular file under a project — both should be skipped
	os.MkdirAll(filepath.Join(base, "sessions", "proj", ".hidden"), 0755)
	os.WriteFile(filepath.Join(base, "sessions", "proj", "not-a-dir"), []byte("x"), 0644)

	WriteState("proj/real-session", StatusWorking, "ok", 1)

	sessions, err := ListSessions()
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Errorf("expected 1 session, got %d", len(sessions))
	}
	if sessions[0].Session != "proj/real-session" {
		t.Errorf("expected proj/real-session, got %q", sessions[0].Session)
	}
}

func TestParseName(t *testing.T) {
	tests := []struct {
		input   string
		project string
		ticket  string
		session string
		wantErr bool
	}{
		{"proj/session", "proj", "", "session", false},
		{"my-app/fix-bug", "my-app", "", "fix-bug", false},
		{"flat-name", "", "", "", true},
		{"a/b/c", "a", "b", "c", false},
		{"/session", "", "", "", true},
		{"project/", "", "", "", true},
		{"", "", "", "", true},
		{"proj/ticket/session", "proj", "ticket", "session", false},
		{"proj/elky-49/taxonomy", "proj", "elky-49", "taxonomy", false},
		{"proj//session", "", "", "", true},
		{"proj/ticket/", "", "", "", true},
	}
	for _, tt := range tests {
		p, tk, s, err := ParseName(tt.input)
		if (err != nil) != tt.wantErr {
			t.Errorf("ParseName(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			continue
		}
		if p != tt.project || tk != tt.ticket || s != tt.session {
			t.Errorf("ParseName(%q) = (%q, %q, %q), want (%q, %q, %q)", tt.input, p, tk, s, tt.project, tt.ticket, tt.session)
		}
	}
}

func TestSessionDir(t *testing.T) {
	withTempBaseDir(t)

	dir := SessionDir("proj/my-session")
	if filepath.Base(dir) != "my-session" {
		t.Errorf("SessionDir base = %q, want %q", filepath.Base(dir), "my-session")
	}
	if filepath.Base(filepath.Dir(dir)) != "proj" {
		t.Errorf("SessionDir parent = %q, want %q", filepath.Base(filepath.Dir(dir)), "proj")
	}
}

func TestMigrateFlatSessions(t *testing.T) {
	base := withTempBaseDir(t)

	// Create flat sessions (like pre-project era)
	sessDir := filepath.Join(base, "sessions")
	for _, name := range []string{"old-session", "another-one"} {
		dir := filepath.Join(sessDir, name)
		os.MkdirAll(dir, 0755)
		state := `{"session":"` + name + `","status":"done","summary":"old","pid":1}`
		os.WriteFile(filepath.Join(dir, "state.json"), []byte(state), 0644)
	}

	// Also create a real project dir that should NOT be migrated
	WriteState("real-proj/new-session", StatusWorking, "ok", 1)

	count, err := MigrateFlatSessions()
	if err != nil {
		t.Fatalf("MigrateFlatSessions: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 migrated, got %d", count)
	}

	// Verify they were moved to legacy/
	for _, name := range []string{"old-session", "another-one"} {
		statePath := filepath.Join(sessDir, "legacy", name, "state.json")
		if _, err := os.Stat(statePath); err != nil {
			t.Errorf("expected %s to exist after migration", statePath)
		}
	}

	// Verify original locations are gone
	for _, name := range []string{"old-session", "another-one"} {
		statePath := filepath.Join(sessDir, name, "state.json")
		if _, err := os.Stat(statePath); err == nil {
			t.Errorf("expected %s to be removed after migration", statePath)
		}
	}

	// Verify the real project was not migrated
	s, err := ReadState("real-proj/new-session")
	if err != nil {
		t.Fatalf("real project session should still exist: %v", err)
	}
	if s.Status != StatusWorking {
		t.Errorf("expected working, got %q", s.Status)
	}
}
