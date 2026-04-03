package log

import (
	"github.com/uiid-systems/bertrand/internal/schema"
)

// SessionLink represents a notable external reference from a session.
type SessionLink struct {
	Kind  string // "pr", "linear", "notion", "vercel", "branch"
	Label string // human-readable: "PR #42 Add auth flow"
	URL   string // full URL (empty for branches)
}

// ExtractLinks scans typed events for external references (PRs, Linear issues,
// Notion pages, Vercel deploys, worktree branches) and returns them deduplicated
// in event order.
func ExtractLinks(events []*schema.TypedEvent) []SessionLink {
	var links []SessionLink
	seen := make(map[string]bool) // dedup key: URL or "branch:name"

	for _, te := range events {
		switch m := te.TypedMeta.(type) {
		case *schema.GhPrCreatedMeta:
			key := m.PRURL
			if key == "" {
				key = "pr:" + m.PRNumber
			}
			if seen[key] {
				continue
			}
			seen[key] = true
			label := "PR"
			if m.PRNumber != "" {
				label += " #" + m.PRNumber
			}
			if m.PRTitle != "" {
				label += " " + m.PRTitle
			}
			links = append(links, SessionLink{Kind: "pr", Label: label, URL: m.PRURL})

		case *schema.GhPrMergedMeta:
			key := "pr:" + m.PRNumber
			if seen[key] {
				continue
			}
			seen[key] = true
			label := "PR #" + m.PRNumber + " (merged)"
			links = append(links, SessionLink{Kind: "pr", Label: label})

		case *schema.LinearIssueReadMeta:
			if m.IssueID == "" {
				continue
			}
			key := "linear:" + m.IssueID
			if seen[key] {
				continue
			}
			seen[key] = true
			label := m.IssueID
			if m.IssueTitle != "" {
				label += " " + m.IssueTitle
			}
			links = append(links, SessionLink{Kind: "linear", Label: label})

		case *schema.NotionPageReadMeta:
			key := m.PageURL
			if key == "" {
				key = "notion:" + m.PageID
			}
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			label := m.PageTitle
			if label == "" {
				label = m.PageID
			}
			links = append(links, SessionLink{Kind: "notion", Label: label, URL: m.PageURL})

		case *schema.VercelDeployMeta:
			key := m.DeployURL
			if key == "" {
				key = "vercel:" + m.ProjectName
			}
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			label := m.ProjectName
			if label == "" {
				label = "deployment"
			}
			links = append(links, SessionLink{Kind: "vercel", Label: label, URL: m.DeployURL})

		case *schema.WorktreeEnteredMeta:
			if m.Branch == "" {
				continue
			}
			key := "branch:" + m.Branch
			if seen[key] {
				continue
			}
			seen[key] = true
			links = append(links, SessionLink{Kind: "branch", Label: m.Branch})
		}
	}

	return links
}
