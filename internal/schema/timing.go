package schema

import "time"

// TimingType classifies a timing segment.
type TimingType string

const (
	TimingUserWait  TimingType = "user_wait"
	TimingClaudeWork TimingType = "claude_work"
)

// TimingSegment represents a measured interval between log events.
type TimingSegment struct {
	Start    time.Time
	End      time.Time
	Duration time.Duration
	Type     TimingType
	ClaudeID string
}

// TimingSummary aggregates timing data across a session.
type TimingSummary struct {
	TotalUserWait   time.Duration
	TotalClaudeWork time.Duration
	Segments        []TimingSegment
}

// ComputeTimings derives timing segments from a sequence of typed events.
// user_wait: time between session.block and the next session.resume
// claude_work: time between session.resume (or claude.started) and the next session.block (or claude.ended)
func ComputeTimings(events []*TypedEvent) *TimingSummary {
	summary := &TimingSummary{}

	var workStart *TypedEvent  // tracks start of claude work period
	var blockStart *TypedEvent // tracks start of user wait period

	for _, te := range events {
		switch te.Event {
		case "claude.started":
			// Claude starts working
			workStart = te
			blockStart = nil

		case "session.block":
			// Claude stops working, user starts waiting
			if workStart != nil {
				seg := TimingSegment{
					Start:    workStart.TS,
					End:      te.TS,
					Duration: te.TS.Sub(workStart.TS),
					Type:     TimingClaudeWork,
					ClaudeID: te.MetaClaudeID(),
				}
				if seg.Duration > 0 {
					summary.Segments = append(summary.Segments, seg)
					summary.TotalClaudeWork += seg.Duration
				}
			}
			workStart = nil
			blockStart = te

		case "session.resume":
			// User responds, claude starts working again
			if blockStart != nil {
				seg := TimingSegment{
					Start:    blockStart.TS,
					End:      te.TS,
					Duration: te.TS.Sub(blockStart.TS),
					Type:     TimingUserWait,
					ClaudeID: te.MetaClaudeID(),
				}
				if seg.Duration > 0 {
					summary.Segments = append(summary.Segments, seg)
					summary.TotalUserWait += seg.Duration
				}
			}
			blockStart = nil
			workStart = te

		case "claude.ended":
			// Claude conversation ends — close any open work period
			if workStart != nil {
				seg := TimingSegment{
					Start:    workStart.TS,
					End:      te.TS,
					Duration: te.TS.Sub(workStart.TS),
					Type:     TimingClaudeWork,
					ClaudeID: te.MetaClaudeID(),
				}
				if seg.Duration > 0 {
					summary.Segments = append(summary.Segments, seg)
					summary.TotalClaudeWork += seg.Duration
				}
			}
			workStart = nil
			// If user was waiting when claude ended, close that too
			if blockStart != nil {
				seg := TimingSegment{
					Start:    blockStart.TS,
					End:      te.TS,
					Duration: te.TS.Sub(blockStart.TS),
					Type:     TimingUserWait,
					ClaudeID: te.MetaClaudeID(),
				}
				if seg.Duration > 0 {
					summary.Segments = append(summary.Segments, seg)
					summary.TotalUserWait += seg.Duration
				}
			}
			blockStart = nil
		}
	}

	return summary
}
