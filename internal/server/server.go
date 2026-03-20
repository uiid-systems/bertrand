package server

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
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

func New(port int) *http.ServeMux {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("GET /sessions", handleSessions)
	mux.HandleFunc("GET /sessions/{rest...}", handleSessionRoute)
	mux.HandleFunc("POST /sessions/{rest...}", handleSessionRoute)

	// Dashboard SPA — serve Vite build output, fall back to index.html for client-side routing
	staticFS, _ := fs.Sub(staticFiles, "static/dist")
	fileServer := http.FileServer(http.FS(staticFS))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		// Try the actual file first
		if r.URL.Path != "/" {
			f, err := fs.Stat(staticFS, strings.TrimPrefix(r.URL.Path, "/"))
			if err == nil && !f.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		// Fall back to index.html for SPA routing; if no build exists, serve placeholder
		index, err := fs.ReadFile(staticFS, "index.html")
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

// sessionWithFocus extends State with a focused flag for the API response.
type sessionWithFocus struct {
	session.State
	Focused bool `json:"focused"`
}

func handleSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := session.ListSessions()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	focused := session.ReadFocused()
	out := make([]sessionWithFocus, len(sessions))
	for i, s := range sessions {
		out[i] = sessionWithFocus{State: s, Focused: s.Session == focused}
	}
	writeJSON(w, http.StatusOK, out)
}

func handleSessionRoute(w http.ResponseWriter, r *http.Request) {
	rest := r.PathValue("rest")

	// Routes:
	//   GET  /sessions/{project}/{session}/log
	//   POST /sessions/{project}/{session}/focus
	//   GET  /sessions/{project}/{session}

	// Find the action suffix
	var name, action string
	if strings.HasSuffix(rest, "/log") {
		name = strings.TrimSuffix(rest, "/log")
		action = "log"
	} else if strings.HasSuffix(rest, "/focus") {
		name = strings.TrimSuffix(rest, "/focus")
		action = "focus"
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
	case "focus":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		handleSessionFocus(w, r, name)
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

func handleSessionFocus(w http.ResponseWriter, r *http.Request, name string) {
	blockIDPath := filepath.Join(session.SessionDir(name), "wave-block-id")
	data, err := os.ReadFile(blockIDPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no wave-block-id for session"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	blockID := strings.TrimSpace(string(data))
	if blockID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "wave-block-id is empty"})
		return
	}

	wsh, err := exec.LookPath("wsh")
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "wsh not available"})
		return
	}

	if err := exec.Command(wsh, "focusblock", "-b", blockID).Run(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("focusblock failed: %v", err)})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
