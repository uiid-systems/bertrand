export const LINEAR_ORG = "uiid"
export const LINEAR_BASE = `https://linear.app/${LINEAR_ORG}`
export const GITHUB_BASE = "https://github.com/uiid-systems/bertrand"

export function linearIssueUrl(issueId: string): string {
  return `${LINEAR_BASE}/issue/${issueId}`
}

export function githubPrUrl(prNumber: string | number): string {
  return `${GITHUB_BASE}/pull/${prNumber}`
}
