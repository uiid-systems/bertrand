package server

import (
	"embed"
	"encoding/json"
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

	// Dashboard SPA
	staticFS, _ := fs.Sub(staticFiles, "static")
	mux.Handle("GET /", http.FileServer(http.FS(staticFS)))

	return mux
}

func handleSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := session.ListSessions()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if sessions == nil {
		sessions = []session.State{}
	}
	writeJSON(w, http.StatusOK, sessions)
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
	} else {
		name = rest
		action = "state"
	}

	if name == "" || !strings.Contains(name, "/") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session name must be project/session"})
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
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session log not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
