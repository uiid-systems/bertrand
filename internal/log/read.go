package log

import (
	"bufio"
	"os"
	"path/filepath"

	"github.com/uiid-systems/bertrand/internal/schema"
	"github.com/uiid-systems/bertrand/internal/session"
)

// ReadEvents reads and parses all events from a session's log.jsonl.
// This is the ONE place that opens a session log file.
func ReadEvents(name string) ([]*schema.TypedEvent, error) {
	path := filepath.Join(session.SessionDir(name), "log.jsonl")
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var events []*schema.TypedEvent
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		te, err := schema.ParseEvent(scanner.Bytes())
		if err != nil {
			continue
		}
		events = append(events, te)
	}
	return events, scanner.Err()
}

// Enrich converts a raw TypedEvent into a display-ready EnrichedEvent.
func Enrich(te *schema.TypedEvent) EnrichedEvent {
	info := Lookup(te.Event)
	return EnrichedEvent{
		Event:    te.Event,
		Session:  te.Session,
		TS:       te.TS,
		Summary:  te.MetaSummary(),
		Label:    info.Label,
		Category: info.Category,
		Color:    info.Color,
		Meta:     te.TypedMeta,
	}
}

// EnrichAll converts a slice of TypedEvents into EnrichedEvents.
func EnrichAll(events []*schema.TypedEvent) []EnrichedEvent {
	enriched := make([]EnrichedEvent, 0, len(events))
	for _, te := range events {
		enriched = append(enriched, Enrich(te))
	}
	return enriched
}
