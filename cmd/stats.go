package cmd

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	sessionlog "github.com/uiid-systems/bertrand/internal/log"
	"github.com/uiid-systems/bertrand/internal/session"
)

var statsJSON bool

var statsCmd = &cobra.Command{
	Use:   "stats [project]",
	Short: "Show aggregate statistics across sessions",
	Long:  "Without arguments, shows global metrics. With a project name, shows per-session breakdown.",
	ValidArgsFunction: func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		if len(args) > 0 {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		projects, err := session.ListProjects()
		if err != nil {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		return projects, cobra.ShellCompDirectiveNoFileComp
	},
	RunE: runStats,
}

func init() {
	statsCmd.Flags().BoolVar(&statsJSON, "json", false, "Output as JSON")
	rootCmd.AddCommand(statsCmd)
}

type sessionMetrics struct {
	name          string
	status        string
	duration      time.Duration
	claudeWork    time.Duration
	userWait      time.Duration
	conversations int
	prs           int
	interactions  int
}

func collectSessionMetrics(name string, state *session.State) *sessionMetrics {
	d, err := sessionlog.Digest(name)
	if err != nil {
		return nil
	}

	return &sessionMetrics{
		name:          name,
		status:        state.Status,
		duration:      d.EndedAt.Sub(d.StartedAt),
		claudeWork:    time.Duration(d.Timing.ClaudeWorkS) * time.Second,
		userWait:      time.Duration(d.Timing.UserWaitS) * time.Second,
		conversations: d.Conversations,
		prs:           d.PRs,
		interactions:  d.Interactions,
	}
}

func runStats(cmd *cobra.Command, args []string) error {
	if len(args) > 0 {
		return showProjectStats(args[0])
	}
	return showGlobalStats()
}

func showGlobalStats() error {
	projects, err := session.ListProjects()
	if err != nil || len(projects) == 0 {
		fmt.Println("No sessions found.")
		return nil
	}

	var allMetrics []*sessionMetrics
	activeCount := 0

	for _, project := range projects {
		sessions, err := session.ListSessionsForProject(project)
		if err != nil {
			continue
		}
		for _, s := range sessions {
			m := collectSessionMetrics(s.Session, &s)
			if m == nil {
				continue
			}
			allMetrics = append(allMetrics, m)
			if s.Status != session.StatusDone {
				activeCount++
			}
		}
	}

	if len(allMetrics) == 0 {
		fmt.Println("No sessions found.")
		return nil
	}

	var totalDuration, totalClaude, totalUser time.Duration
	totalConvs := 0
	totalPRs := 0
	totalInteractions := 0

	for _, m := range allMetrics {
		totalDuration += m.duration
		totalClaude += m.claudeWork
		totalUser += m.userWait
		totalConvs += m.conversations
		totalPRs += m.prs
		totalInteractions += m.interactions
	}

	if statsJSON {
		data, _ := json.Marshal(map[string]interface{}{
			"projects":      len(projects),
			"sessions":      len(allMetrics),
			"active":        activeCount,
			"total_s":       int(totalDuration.Seconds()),
			"claude_work_s": int(totalClaude.Seconds()),
			"user_wait_s":   int(totalUser.Seconds()),
			"conversations": totalConvs,
			"prs_created":   totalPRs,
			"interactions":  totalInteractions,
		})
		fmt.Println(string(data))
		return nil
	}

	fmt.Printf("\033[1mbertrand\033[0m  %d projects  %d sessions  %d active\n\n",
		len(projects), len(allMetrics), activeCount)

	total := totalClaude + totalUser
	claudePct := 0
	userPct := 0
	if total > 0 {
		claudePct = int(float64(totalClaude) / float64(total) * 100)
		userPct = 100 - claudePct
	}

	fmt.Printf("  Total time     %s\n", sessionlog.FormatDuration(totalDuration))
	fmt.Printf("  Claude work    %s", sessionlog.FormatDuration(totalClaude))
	if claudePct > 0 {
		fmt.Printf(" (%d%%)", claudePct)
	}
	fmt.Println()
	fmt.Printf("  User wait      %s", sessionlog.FormatDuration(totalUser))
	if userPct > 0 {
		fmt.Printf(" (%d%%)", userPct)
	}
	fmt.Println()
	fmt.Printf("  Conversations  %d\n", totalConvs)
	fmt.Printf("  PRs created    %d\n", totalPRs)
	fmt.Printf("  Interactions   %d\n", totalInteractions)

	return nil
}

func showProjectStats(project string) error {
	sessions, err := session.ListSessionsForProject(project)
	if err != nil || len(sessions) == 0 {
		return fmt.Errorf("no sessions found for project %q", project)
	}

	var metrics []*sessionMetrics
	activeCount := 0

	for _, s := range sessions {
		m := collectSessionMetrics(s.Session, &s)
		if m == nil {
			continue
		}
		metrics = append(metrics, m)
		if s.Status != session.StatusDone {
			activeCount++
		}
	}

	if len(metrics) == 0 {
		return fmt.Errorf("no sessions found for project %q", project)
	}

	// Sort by duration descending
	sort.Slice(metrics, func(i, j int) bool {
		return metrics[i].duration > metrics[j].duration
	})

	if statsJSON {
		type jsonRow struct {
			Session       string `json:"session"`
			Status        string `json:"status"`
			DurationS     int    `json:"duration_s"`
			ClaudeWorkS   int    `json:"claude_work_s"`
			UserWaitS     int    `json:"user_wait_s"`
			Conversations int    `json:"conversations"`
			PRs           int    `json:"prs_created"`
			Interactions  int    `json:"interactions"`
		}
		for _, m := range metrics {
			data, _ := json.Marshal(jsonRow{
				Session:       m.name,
				Status:        m.status,
				DurationS:     int(m.duration.Seconds()),
				ClaudeWorkS:   int(m.claudeWork.Seconds()),
				UserWaitS:     int(m.userWait.Seconds()),
				Conversations: m.conversations,
				PRs:           m.prs,
				Interactions:  m.interactions,
			})
			fmt.Println(string(data))
		}
		return nil
	}

	fmt.Printf("\033[1m%s\033[0m  %d sessions  %d active\n\n", project, len(metrics), activeCount)

	// Find the longest session name for column alignment
	maxName := 7 // "Session"
	for _, m := range metrics {
		// Strip project prefix for display
		short := m.name
		if idx := strings.Index(short, "/"); idx >= 0 {
			short = short[idx+1:]
		}
		if len(short) > maxName {
			maxName = len(short)
		}
	}

	// Header
	fmt.Printf("  %-*s  %8s  %8s  %8s  %5s  %3s\n",
		maxName, "Session", "Duration", "Claude", "User", "Convs", "PRs")

	var totalDuration, totalClaude, totalUser time.Duration
	totalConvs := 0
	totalPRs := 0

	for _, m := range metrics {
		short := m.name
		if idx := strings.Index(short, "/"); idx >= 0 {
			short = short[idx+1:]
		}

		totalDuration += m.duration
		totalClaude += m.claudeWork
		totalUser += m.userWait
		totalConvs += m.conversations
		totalPRs += m.prs

		fmt.Printf("  %-*s  %8s  %8s  %8s  %5d  %3d\n",
			maxName, short,
			sessionlog.FormatDuration(m.duration),
			sessionlog.FormatDuration(m.claudeWork),
			sessionlog.FormatDuration(m.userWait),
			m.conversations,
			m.prs)
	}

	// Totals row
	fmt.Printf("\n  %-*s  %8s  %8s  %8s  %5d  %3d\n",
		maxName, "Total",
		sessionlog.FormatDuration(totalDuration),
		sessionlog.FormatDuration(totalClaude),
		sessionlog.FormatDuration(totalUser),
		totalConvs,
		totalPRs)

	return nil
}
