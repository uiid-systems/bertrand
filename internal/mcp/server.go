package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	sessionlog "github.com/uiid-systems/bertrand/internal/log"
	"github.com/uiid-systems/bertrand/internal/session"
)

// NewServer creates a new MCP server exposing bertrand session data.
// sessionName is the current bertrand session (from BERTRAND_SESSION env var),
// used to scope sibling queries.
func NewServer(sessionName string) *server.MCPServer {
	s := server.NewMCPServer(
		"bertrand",
		"0.1.0",
		server.WithResourceCapabilities(false, false),
	)

	// Static resources
	if sessionName != "" {
		s.AddResource(
			mcp.Resource{
				URI:         "bertrand://siblings",
				Name:        "Sibling Sessions",
				Description: "Context for sibling sessions in the same project/ticket scope as the current session",
				MIMEType:    "text/plain",
			},
			siblingsHandler(sessionName),
		)
	}

	// Resource templates (parameterized)
	s.AddResourceTemplate(
		mcp.NewResourceTemplate(
			"bertrand://sessions{?project}",
			"Session List",
			mcp.WithTemplateDescription("List all bertrand sessions. Optional project filter."),
		),
		sessionsHandler,
	)

	s.AddResourceTemplate(
		mcp.NewResourceTemplate(
			"bertrand://sessions/{name}/digest",
			"Session Digest",
			mcp.WithTemplateDescription("Full digest for a session: timeline, timing, counts, PRs."),
		),
		sessionDigestHandler,
	)

	s.AddResourceTemplate(
		mcp.NewResourceTemplate(
			"bertrand://sessions/{name}/events{?last}",
			"Session Events",
			mcp.WithTemplateDescription("Raw events for a session. Use ?last=N to get only the last N events."),
		),
		sessionEventsHandler,
	)

	s.AddResourceTemplate(
		mcp.NewResourceTemplate(
			"bertrand://sessions/{name}/state",
			"Session State",
			mcp.WithTemplateDescription("Current state (status, summary, PID) for a session."),
		),
		sessionStateHandler,
	)

	// Tools
	s.AddTool(
		mcp.NewTool("search_events",
			mcp.WithDescription("Search events across bertrand sessions by type and/or time range"),
			mcp.WithReadOnlyHintAnnotation(true),
			mcp.WithDestructiveHintAnnotation(false),
			mcp.WithString("event_type", mcp.Description("Filter by event type (e.g. gh.pr.created, session.block)")),
			mcp.WithString("since", mcp.Description("Only events after this time (RFC3339 or duration like 1h, 24h)")),
			mcp.WithString("session", mcp.Description("Scope to a specific session name (default: all sessions)")),
		),
		searchEventsHandler,
	)

	s.AddTool(
		mcp.NewTool("session_summary",
			mcp.WithDescription("Get a focused summary of a specific bertrand session"),
			mcp.WithReadOnlyHintAnnotation(true),
			mcp.WithDestructiveHintAnnotation(false),
			mcp.WithString("session_name", mcp.Description("The session name (e.g. project/ticket/session)"), mcp.Required()),
		),
		sessionSummaryHandler,
	)

	return s
}

// Serve runs the MCP server over stdio.
func Serve(stdin io.Reader, stdout io.Writer) error {
	sessionName := os.Getenv("BERTRAND_SESSION")
	srv := NewServer(sessionName)
	return server.ServeStdio(srv, server.WithStdioContextFunc(func(ctx context.Context) context.Context {
		return ctx
	}))
}

// --- Resource Handlers ---

func siblingsHandler(sessionName string) server.ResourceHandlerFunc {
	return func(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
		result := session.SiblingSummaries(sessionName)
		if result == "" {
			result = "No sibling sessions found."
		}
		return []mcp.ResourceContents{
			mcp.TextResourceContents{
				URI:  "bertrand://siblings",
				Text: result,
			},
		}, nil
	}
}

func sessionsHandler(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
	project := mcp.ExtractString(request.Params.Arguments, "project")

	var sessions []session.State
	var err error

	if project != "" {
		sessions, err = session.ListSessionsForProject(project)
	} else {
		sessions, err = session.ListSessions()
	}
	if err != nil {
		return nil, fmt.Errorf("listing sessions: %w", err)
	}

	var lines []string
	for _, s := range sessions {
		wt := session.ReadWorktree(s.Session)
		line := fmt.Sprintf("%s: %s", s.Session, s.Status)
		if s.Summary != "" {
			line += fmt.Sprintf(" — %q", s.Summary)
		}
		if wt != "" {
			line += fmt.Sprintf(" (worktree: %s)", wt)
		}
		lines = append(lines, line)
	}

	text := "No sessions found."
	if len(lines) > 0 {
		text = strings.Join(lines, "\n")
	}

	return []mcp.ResourceContents{
		mcp.TextResourceContents{
			URI:  request.Params.URI,
			Text: text,
		},
	}, nil
}

func sessionDigestHandler(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
	name := extractSessionName(request.Params.URI, "bertrand://sessions/", "/digest")
	if name == "" {
		return nil, fmt.Errorf("invalid session URI: %s", request.Params.URI)
	}

	digest, err := sessionlog.Digest(name)
	if err != nil {
		return nil, fmt.Errorf("reading digest for %s: %w", name, err)
	}

	// Format as readable text
	var sb strings.Builder
	fmt.Fprintf(&sb, "Session: %s\n", digest.Session)
	fmt.Fprintf(&sb, "Duration: %ds\n", digest.DurationS)
	fmt.Fprintf(&sb, "Events: %d | Conversations: %d | PRs: %d | Interactions: %d\n",
		digest.EventCount, digest.Conversations, digest.PRs, digest.Interactions)
	fmt.Fprintf(&sb, "Timing: claude %ds, user %ds (%d%% active)\n",
		digest.Timing.ClaudeWorkS, digest.Timing.UserWaitS, digest.Timing.ActivePct)
	sb.WriteString("\nTimeline:\n")
	for _, e := range digest.Timeline {
		fmt.Fprintf(&sb, "  %s %s\n", e.TS.Format("15:04"), e.Summary)
	}

	return []mcp.ResourceContents{
		mcp.TextResourceContents{
			URI:  request.Params.URI,
			Text: sb.String(),
		},
	}, nil
}

func sessionEventsHandler(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
	name := extractSessionName(request.Params.URI, "bertrand://sessions/", "/events")
	if name == "" {
		return nil, fmt.Errorf("invalid session URI: %s", request.Params.URI)
	}

	events, err := sessionlog.ReadEvents(name)
	if err != nil {
		return nil, fmt.Errorf("reading events for %s: %w", name, err)
	}

	// Apply ?last parameter
	lastStr := mcp.ExtractString(request.Params.Arguments, "last")
	if lastStr != "" {
		var last int
		fmt.Sscanf(lastStr, "%d", &last)
		if last > 0 && last < len(events) {
			events = events[len(events)-last:]
		}
	}

	var lines []string
	for _, e := range events {
		data, _ := json.Marshal(map[string]any{
			"event":   e.Event,
			"ts":      e.TS.Format(time.RFC3339),
			"session": e.Session,
		})
		lines = append(lines, string(data))
	}

	text := "No events found."
	if len(lines) > 0 {
		text = strings.Join(lines, "\n")
	}

	return []mcp.ResourceContents{
		mcp.TextResourceContents{
			URI:  request.Params.URI,
			Text: text,
		},
	}, nil
}

func sessionStateHandler(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
	name := extractSessionName(request.Params.URI, "bertrand://sessions/", "/state")
	if name == "" {
		return nil, fmt.Errorf("invalid session URI: %s", request.Params.URI)
	}

	state, err := session.ReadState(name)
	if err != nil {
		return nil, fmt.Errorf("reading state for %s: %w", name, err)
	}

	wt := session.ReadWorktree(name)
	var sb strings.Builder
	fmt.Fprintf(&sb, "Session: %s\n", state.Session)
	fmt.Fprintf(&sb, "Status: %s\n", state.Status)
	fmt.Fprintf(&sb, "Summary: %s\n", state.Summary)
	fmt.Fprintf(&sb, "PID: %d\n", state.PID)
	fmt.Fprintf(&sb, "Timestamp: %s\n", state.Timestamp.Format(time.RFC3339))
	if wt != "" {
		fmt.Fprintf(&sb, "Worktree: %s\n", wt)
	}

	return []mcp.ResourceContents{
		mcp.TextResourceContents{
			URI:  request.Params.URI,
			Text: sb.String(),
		},
	}, nil
}

// --- Tool Handlers ---

func searchEventsHandler(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	eventType := mcp.ParseString(request, "event_type", "")
	sinceStr := mcp.ParseString(request, "since", "")
	sessionFilter := mcp.ParseString(request, "session", "")

	// Parse since parameter
	var sinceTime time.Time
	if sinceStr != "" {
		// Try duration format first (e.g. "1h", "24h")
		if d, err := time.ParseDuration(sinceStr); err == nil {
			sinceTime = time.Now().Add(-d)
		} else if t, err := time.Parse(time.RFC3339, sinceStr); err == nil {
			sinceTime = t
		}
	}

	// Get sessions to search
	var sessions []session.State
	var err error
	if sessionFilter != "" {
		state, e := session.ReadState(sessionFilter)
		if e != nil {
			return mcp.NewToolResultError(fmt.Sprintf("session not found: %s", sessionFilter)), nil
		}
		sessions = []session.State{*state}
	} else {
		sessions, err = session.ListSessions()
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("listing sessions: %v", err)), nil
		}
	}

	var results []string
	for _, s := range sessions {
		events, err := sessionlog.ReadEvents(s.Session)
		if err != nil {
			continue
		}
		for _, e := range events {
			if eventType != "" && e.Event != eventType {
				continue
			}
			if !sinceTime.IsZero() && e.TS.Before(sinceTime) {
				continue
			}
			results = append(results, fmt.Sprintf("[%s] %s %s: %s",
				e.TS.Format("2006-01-02 15:04"), s.Session, e.Event, e.MetaSummary()))
		}
	}

	if len(results) == 0 {
		return mcp.NewToolResultText("No matching events found."), nil
	}

	// Cap results to avoid token explosion
	if len(results) > 50 {
		results = results[len(results)-50:]
	}

	return mcp.NewToolResultText(strings.Join(results, "\n")), nil
}

func sessionSummaryHandler(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	name := mcp.ParseString(request, "session_name", "")
	if name == "" {
		return mcp.NewToolResultError("session_name is required"), nil
	}

	// Build summary from digest
	digest, err := sessionlog.Digest(name)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("reading digest for %s: %v", name, err)), nil
	}

	state, _ := session.ReadState(name)
	wt := session.ReadWorktree(name)

	var sb strings.Builder
	fmt.Fprintf(&sb, "Session: %s\n", name)
	if state != nil {
		fmt.Fprintf(&sb, "Status: %s\n", state.Status)
		if state.Summary != "" {
			fmt.Fprintf(&sb, "Summary: %s\n", state.Summary)
		}
	}
	if wt != "" {
		fmt.Fprintf(&sb, "Worktree: %s\n", wt)
	}
	fmt.Fprintf(&sb, "Duration: %ds | Events: %d | Conversations: %d | PRs: %d\n",
		digest.DurationS, digest.EventCount, digest.Conversations, digest.PRs)
	fmt.Fprintf(&sb, "Timing: claude %ds, user %ds (%d%% active)\n",
		digest.Timing.ClaudeWorkS, digest.Timing.UserWaitS, digest.Timing.ActivePct)

	// Add compact timeline
	sb.WriteString("\nRecent activity:\n")
	timeline := digest.Timeline
	if len(timeline) > 10 {
		timeline = timeline[len(timeline)-10:]
	}
	for _, e := range timeline {
		fmt.Fprintf(&sb, "  %s %s\n", e.TS.Format("15:04"), e.Summary)
	}

	// Add PR URLs
	prs := sessionlog.SiblingPRs(name)
	if len(prs) > 0 {
		sb.WriteString("\nPRs:\n")
		for _, url := range prs {
			fmt.Fprintf(&sb, "  %s\n", url)
		}
	}

	return mcp.NewToolResultText(sb.String()), nil
}

// --- Helpers ---

// extractSessionName extracts the session name from a resource URI given a prefix and suffix.
// For example: "bertrand://sessions/project/ticket/session/digest" with prefix "bertrand://sessions/"
// and suffix "/digest" returns "project/ticket/session".
func extractSessionName(uri, prefix, suffix string) string {
	if !strings.HasPrefix(uri, prefix) {
		return ""
	}
	name := strings.TrimPrefix(uri, prefix)

	// Strip query parameters
	if idx := strings.Index(name, "?"); idx != -1 {
		name = name[:idx]
	}

	if suffix != "" && strings.HasSuffix(name, suffix) {
		name = strings.TrimSuffix(name, suffix)
	}
	return name
}
