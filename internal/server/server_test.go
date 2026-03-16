package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetSessions(t *testing.T) {
	mux := New(DefaultPort)
	req := httptest.NewRequest(http.MethodGet, "/sessions", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("expected application/json, got %s", ct)
	}

	var sessions []json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &sessions); err != nil {
		t.Fatalf("invalid JSON response: %v", err)
	}
}

func TestSessionNotFound(t *testing.T) {
	mux := New(DefaultPort)
	req := httptest.NewRequest(http.MethodGet, "/sessions/nonexistent/fakesession", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestSessionLogNotFound(t *testing.T) {
	mux := New(DefaultPort)
	req := httptest.NewRequest(http.MethodGet, "/sessions/nonexistent/fakesession/log", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestBadSessionName(t *testing.T) {
	mux := New(DefaultPort)
	req := httptest.NewRequest(http.MethodGet, "/sessions/noproject", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
