package server

import (
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	sessionlog "github.com/uiid-systems/bertrand/internal/log"
	"github.com/uiid-systems/bertrand/internal/session"
)

//go:embed static
var staticFiles embed.FS

const DefaultPort = 7779

// New creates the dashboard HTTP mux. If webDir is non-empty and points to a
// directory on disk, assets are served from the filesystem (dev mode). Otherwise
// the compile-time embedded assets are used (production / Homebrew installs).
func New(port int, webDir string) *http.ServeMux {
	mux := http.NewServeMux()

	// Recover any persisted preview state from prior server runs.
	loadPreviewStates()

	// API routes
	mux.HandleFunc("GET /sessions", handleSessions)
	mux.HandleFunc("GET /worktrees", handleWorktrees)
	mux.HandleFunc("POST /preview/start", handlePreviewStart)
	mux.HandleFunc("POST /preview/stop", handlePreviewStop)
	mux.HandleFunc("GET /sessions/{rest...}", handleSessionRoute)
	mux.HandleFunc("POST /sessions/{rest...}", handleSessionRoute)

	// Resolve the asset filesystem: prefer on-disk dir for dev, embedded for prod.
	var assetFS fs.FS
	if webDir != "" {
		if info, err := os.Stat(webDir); err == nil && info.IsDir() {
			assetFS = os.DirFS(webDir)
		}
	}
	if assetFS == nil {
		assetFS, _ = fs.Sub(staticFiles, "static/dist")
	}

	fileServer := http.FileServer(http.FS(assetFS))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		// Try the actual file first
		if r.URL.Path != "/" {
			f, err := fs.Stat(assetFS, strings.TrimPrefix(r.URL.Path, "/"))
			if err == nil && !f.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		// Fall back to index.html for SPA routing; if no build exists, serve placeholder
		index, err := fs.ReadFile(assetFS, "index.html")
		if err != nil {
			index, err = fs.ReadFile(staticFiles, "static/placeholder.html")
			if err != nil {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	})

	return mux
}

// sessionResponse extends State with a worktree branch for the API response.
type sessionResponse struct {
	session.State
	Worktree string `json:"worktree,omitempty"`
}

func handleSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := session.ListSessions()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	out := make([]sessionResponse, len(sessions))
	for i, s := range sessions {
		out[i] = sessionResponse{
			State:    s,
			Worktree: session.ReadWorktree(s.Session),
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func handleSessionRoute(w http.ResponseWriter, r *http.Request) {
	rest := r.PathValue("rest")

	// Routes:
	//   GET  /sessions/{project}/{session}/log
	//   GET  /sessions/{project}/{session}

	// Find the action suffix
	var name, action string
	if strings.HasSuffix(rest, "/log") {
		name = strings.TrimSuffix(rest, "/log")
		action = "log"
	} else if strings.HasSuffix(rest, "/archive") {
		name = strings.TrimSuffix(rest, "/archive")
		action = "archive"
	} else if strings.HasSuffix(rest, "/delete") {
		name = strings.TrimSuffix(rest, "/delete")
		action = "delete"
	} else {
		name = rest
		action = "state"
	}

	if name == "" || !strings.Contains(name, "/") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session name must be project/session or project/ticket/session"})
		return
	}

	switch action {
	case "log":
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		handleSessionLog(w, r, name)
	case "archive":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		handleSessionArchive(w, r, name)
	case "delete":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		handleSessionDelete(w, r, name)
	case "state":
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		handleSessionState(w, r, name)
	}
}

func handleSessionState(w http.ResponseWriter, r *http.Request, name string) {
	state, err := session.ReadState(name)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func handleSessionLog(w http.ResponseWriter, r *http.Request, name string) {
	d, err := sessionlog.DigestWithOptions(name, sessionlog.DigestOptions{IncludeFullEvents: true})
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session log not found"})
			return
		}
		// "no events" → return empty-ish digest as 404
		if strings.Contains(err.Error(), "no events") {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Tail: return last 100 events (matches old handler behavior)
	if len(d.Events) > 100 {
		d.Events = d.Events[len(d.Events)-100:]
	}

	writeJSON(w, http.StatusOK, d)
}

func handleSessionArchive(w http.ResponseWriter, r *http.Request, name string) {
	s, err := session.ReadState(name)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if session.IsLive(s.Status) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "cannot archive live session"})
		return
	}
	if err := session.WriteState(name, session.StatusArchived, s.Summary, s.PID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func handleSessionDelete(w http.ResponseWriter, r *http.Request, name string) {
	s, err := session.ReadState(name)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if session.IsLive(s.Status) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "cannot delete live session"})
		return
	}
	if err := session.DeleteSession(name); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

type worktreeResponse struct {
	Branch         string             `json:"branch"`
	Sessions       []string           `json:"sessions"`
	Files          []session.FileDiff `json:"files"`
	TotalAdditions int                `json:"total_additions"`
	TotalDeletions int                `json:"total_deletions"`
	PreviewURL     string             `json:"preview_url,omitempty"`
	HasDevCommand  bool               `json:"has_dev_command"`
}

func handleWorktrees(w http.ResponseWriter, r *http.Request) {
	sessions, err := session.ListSessions()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Group sessions by worktree branch, track worktree dirs from marker files
	type branchInfo struct {
		sessions []string
		wtDir    string // filesystem path if known
	}
	branches := make(map[string]*branchInfo)

	for _, s := range sessions {
		branch := session.ReadWorktree(s.Session)
		if branch == "" {
			continue
		}
		bi, ok := branches[branch]
		if !ok {
			bi = &branchInfo{}
			branches[branch] = bi
		}
		bi.sessions = append(bi.sessions, s.Session)
		// Prefer a stored worktree dir
		if bi.wtDir == "" {
			bi.wtDir = session.ReadWorktreeDir(s.Session)
		}
	}

	if len(branches) == 0 {
		writeJSON(w, http.StatusOK, []worktreeResponse{})
		return
	}

	// Fall back to current repo for branches without a stored path
	repoDir := session.FindRepoRoot()

	var out []worktreeResponse
	for branch, bi := range branches {
		wt := worktreeResponse{
			Branch:   branch,
			Sessions: bi.sessions,
		}

		// Resolve worktree filesystem path
		wtPath := bi.wtDir
		if wtPath == "" && repoDir != "" {
			wtPath, _ = session.ResolveWorktreePath(repoDir, branch)
		}
		if wtPath == "" {
			wtPath = session.FindWorktreePathByBranch(branch)
		}

		if wtPath != "" {
			// Detect main branch for the repo this worktree belongs to
			wtRepoRoot := repoRootFromWorktree(wtPath)
			if wtRepoRoot == "" {
				wtRepoRoot = repoDir
			}
			mainBranch := session.DetectMainBranch(wtRepoRoot)

			files, err := session.DiffNumstat(wtPath, mainBranch)
			if err == nil {
				wt.Files = files
				for _, f := range files {
					wt.TotalAdditions += f.Additions
					wt.TotalDeletions += f.Deletions
				}
			}
		}

		if wt.Files == nil {
			wt.Files = []session.FileDiff{}
		}

		// Preview state
		if wtPath != "" {
			wt.HasDevCommand = hasDevCommand(wtPath)
		}
		if ps := getPreviewForBranch(branch); ps != nil {
			wt.PreviewURL = ps.URL
		}

		out = append(out, wt)
	}

	writeJSON(w, http.StatusOK, out)
}

func handlePreviewStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Branch string `json:"branch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Branch == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "branch is required"})
		return
	}

	wtPath := resolveWorktreePath(req.Branch)
	if wtPath == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "could not resolve worktree path for branch"})
		return
	}

	ps, err := startPreview(req.Branch, wtPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"url": ps.URL})
}

func handlePreviewStop(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Branch string `json:"branch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Branch == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "branch is required"})
		return
	}

	if err := stopPreview(req.Branch); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// repoRootFromWorktree returns the main repo root for a worktree path.
func repoRootFromWorktree(wtPath string) string {
	cmd := exec.Command("git", "-C", wtPath, "rev-parse", "--path-format=absolute", "--git-common-dir")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	gitDir := strings.TrimSpace(string(out))
	// gitDir is like /repo/.git — parent is repo root
	return filepath.Dir(gitDir)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
