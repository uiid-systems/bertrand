package server

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	"github.com/uiid-systems/bertrand/internal/session"
)

// previewState tracks a running dev server for a worktree.
type previewState struct {
	Branch  string `json:"branch"`
	PID     int    `json:"pid"`
	URL     string `json:"url"`
	WtPath  string `json:"wt_path"`
	Command string `json:"command"`
	Port    int    `json:"port,omitempty"` // only set for fallback (non-portless)
}

// previews holds running preview state keyed by branch name.
var previews sync.Map

// previewDir returns the directory for preview state files.
func previewDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".bertrand", "preview")
}

// portlessDir returns the directory where bertrand manages its portless install.
func portlessDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".bertrand", "portless")
}

// portlessBin returns the path to the portless binary.
func portlessBin() string {
	return filepath.Join(portlessDir(), "node_modules", ".bin", "portless")
}

// encodeBranch converts a branch name to a filesystem-safe string.
func encodeBranch(branch string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(branch))
}

// stateFilePath returns the path to a preview state file.
func stateFilePath(branch string) string {
	return filepath.Join(previewDir(), encodeBranch(branch)+".json")
}

// logFilePath returns the path to a preview log file.
func logFilePath(branch string) string {
	return filepath.Join(previewDir(), encodeBranch(branch)+".log")
}

// writePreviewState persists preview state to disk and memory.
func writePreviewState(ps previewState) error {
	if err := os.MkdirAll(previewDir(), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(ps)
	if err != nil {
		return err
	}
	previews.Store(ps.Branch, ps)
	return os.WriteFile(stateFilePath(ps.Branch), data, 0o644)
}

// removePreviewState removes state from disk and memory.
func removePreviewState(branch string) {
	previews.Delete(branch)
	os.Remove(stateFilePath(branch))
	os.Remove(logFilePath(branch))
}

// getPreviewForBranch returns the preview state if one is running.
func getPreviewForBranch(branch string) *previewState {
	v, ok := previews.Load(branch)
	if !ok {
		return nil
	}
	ps := v.(previewState)
	return &ps
}

// loadPreviewStates reads all persisted preview states on startup,
// cleans dead processes, and repopulates the in-memory map.
func loadPreviewStates() {
	dir := previewDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var ps previewState
		if err := json.Unmarshal(data, &ps); err != nil {
			continue
		}
		if ps.PID > 0 && session.IsProcessAlive(ps.PID) {
			previews.Store(ps.Branch, ps)
		} else {
			// Dead process — clean up
			removePreviewState(ps.Branch)
		}
	}
}

// ensurePortless installs portless to ~/.bertrand/portless/ if not present.
// Returns the path to the portless binary, or empty string if unavailable.
func ensurePortless() string {
	bin := portlessBin()
	if _, err := os.Stat(bin); err == nil {
		return bin
	}

	// Check if npm/node is available
	npmPath, err := exec.LookPath("npm")
	if err != nil {
		return ""
	}

	dir := portlessDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return ""
	}

	cmd := exec.Command(npmPath, "install", "--prefix", dir, "portless")
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Run(); err != nil {
		return ""
	}

	if _, err := os.Stat(bin); err == nil {
		return bin
	}
	return ""
}

// hasDevCommand checks if a worktree path has a package.json with a dev or start script.
func hasDevCommand(wtPath string) bool {
	if wtPath == "" {
		return false
	}
	pkgPath := filepath.Join(wtPath, "package.json")
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return false
	}
	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return false
	}
	_, hasDev := pkg.Scripts["dev"]
	_, hasStart := pkg.Scripts["start"]
	return hasDev || hasStart
}

// detectDevCommand determines the dev command and package manager for a worktree.
func detectDevCommand(wtPath string) (pm string, script string, err error) {
	// Check config override
	home, _ := os.UserHomeDir()
	configPath := filepath.Join(home, ".bertrand", "config.yaml")
	if data, err := os.ReadFile(configPath); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "dev_command:") {
				override := strings.TrimSpace(strings.TrimPrefix(trimmed, "dev_command:"))
				override = strings.Trim(override, "\"'")
				if override != "" {
					parts := strings.Fields(override)
					if len(parts) >= 2 {
						return parts[0], strings.Join(parts[1:], " "), nil
					}
					return override, "", nil
				}
			}
		}
	}

	// Read package.json to determine which script to run
	pkgPath := filepath.Join(wtPath, "package.json")
	data, readErr := os.ReadFile(pkgPath)
	if readErr != nil {
		return "", "", fmt.Errorf("no package.json found in %s", wtPath)
	}
	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return "", "", fmt.Errorf("invalid package.json: %w", err)
	}

	if _, ok := pkg.Scripts["dev"]; ok {
		script = "dev"
	} else if _, ok := pkg.Scripts["start"]; ok {
		script = "start"
	} else {
		return "", "", fmt.Errorf("no dev or start script in package.json")
	}

	// Detect package manager from lockfile
	pm = "npm"
	lockfiles := map[string]string{
		"pnpm-lock.yaml": "pnpm",
		"yarn.lock":      "yarn",
		"bun.lockb":      "bun",
		"package-lock.json": "npm",
	}
	for file, manager := range lockfiles {
		if _, err := os.Stat(filepath.Join(wtPath, file)); err == nil {
			pm = manager
			break
		}
	}

	return pm, script, nil
}

// sanitizeBranchName creates a portless-friendly name from a branch.
func sanitizeBranchName(branch string) string {
	name := strings.NewReplacer("/", "-", "_", "-").Replace(branch)
	// Remove any prefix like "worktree-"
	name = strings.TrimPrefix(name, "worktree-")
	return name
}

// findAvailablePort scans the 3100-3199 range for a free port.
func findAvailablePort() (int, error) {
	used := make(map[int]bool)
	previews.Range(func(_, v any) bool {
		ps := v.(previewState)
		if ps.Port > 0 {
			used[ps.Port] = true
		}
		return true
	})

	for port := 3100; port < 3200; port++ {
		if used[port] {
			continue
		}
		ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
		if err != nil {
			continue
		}
		ln.Close()
		return port, nil
	}
	return 0, fmt.Errorf("no available ports in range 3100-3199")
}

// startPreview starts a dev server in the given worktree.
func startPreview(branch, wtPath string) (*previewState, error) {
	// Check if already running
	if ps := getPreviewForBranch(branch); ps != nil {
		return ps, nil
	}

	pm, script, err := detectDevCommand(wtPath)
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(previewDir(), 0o755); err != nil {
		return nil, err
	}

	logFile, err := os.Create(logFilePath(branch))
	if err != nil {
		return nil, fmt.Errorf("creating log file: %w", err)
	}

	var cmd *exec.Cmd
	var url string
	var port int
	cmdStr := ""

	// Try portless first
	portlessBinPath := ensurePortless()
	if portlessBinPath != "" {
		name := sanitizeBranchName(branch)
		cmd = exec.Command(portlessBinPath, name, pm, "run", script)
		url = fmt.Sprintf("https://%s.localhost", name)
		cmdStr = fmt.Sprintf("%s %s %s run %s", portlessBinPath, name, pm, script)
	} else {
		// Fallback: raw port allocation
		port, err = findAvailablePort()
		if err != nil {
			logFile.Close()
			return nil, err
		}
		cmd = exec.Command(pm, "run", script)
		cmd.Env = append(os.Environ(), fmt.Sprintf("PORT=%d", port))
		url = fmt.Sprintf("http://localhost:%d", port)
		cmdStr = fmt.Sprintf("PORT=%d %s run %s", port, pm, script)
	}

	cmd.Dir = wtPath
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("starting dev server: %w", err)
	}

	ps := previewState{
		Branch:  branch,
		PID:     cmd.Process.Pid,
		URL:     url,
		WtPath:  wtPath,
		Command: cmdStr,
		Port:    port,
	}

	if err := writePreviewState(ps); err != nil {
		// Best effort: kill the process if we can't persist state
		cmd.Process.Kill()
		logFile.Close()
		return nil, err
	}

	// Don't wait for the process — it runs in background
	go func() {
		cmd.Wait()
		logFile.Close()
	}()

	return &ps, nil
}

// stopPreview stops a running preview for a branch.
func stopPreview(branch string) error {
	ps := getPreviewForBranch(branch)
	if ps == nil {
		return nil // not running, nothing to do
	}

	if ps.PID > 0 {
		// Kill the process group (negative PID) to also kill children
		syscall.Kill(-ps.PID, syscall.SIGTERM)
	}

	removePreviewState(branch)
	return nil
}

// resolveWorktreePath resolves the filesystem path for a branch,
// using the same resolution chain as handleWorktrees.
func resolveWorktreePath(branch string) string {
	// Check all sessions for stored worktree dir
	sessions, err := session.ListSessions()
	if err == nil {
		for _, s := range sessions {
			if session.ReadWorktree(s.Session) == branch {
				if dir := session.ReadWorktreeDir(s.Session); dir != "" {
					return dir
				}
			}
		}
	}

	// Try repo-based resolution
	repoDir := session.FindRepoRoot()
	if repoDir != "" {
		if p, err := session.ResolveWorktreePath(repoDir, branch); err == nil {
			return p
		}
	}

	// Broad search
	return session.FindWorktreePathByBranch(branch)
}
