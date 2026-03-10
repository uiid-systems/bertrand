package session

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
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

type State struct {
	Session   string    `json:"session"`
	Status    string    `json:"status"`
	Summary   string    `json:"summary"`
	PID       int       `json:"pid"`
	Timestamp time.Time `json:"timestamp"`
}

func WriteState(name, status, summary string, pid int) error {
	dir := filepath.Join(SessionsDir(), name)
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
	data, err := os.ReadFile(filepath.Join(SessionsDir(), name, "state.json"))
	if err != nil {
		return nil, err
	}
	var s State
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func ListSessions() ([]State, error) {
	dir := SessionsDir()
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
		s, err := ReadState(name)
		if err != nil {
			continue
		}
		sessions = append(sessions, *s)
	}
	return sessions, nil
}

func DeleteSession(name string) error {
	return os.RemoveAll(filepath.Join(SessionsDir(), name))
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
