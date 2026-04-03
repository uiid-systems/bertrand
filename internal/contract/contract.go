package contract

import (
	"fmt"
	"strings"
)

// Template is the base contract. The session name gets injected at launch time.
// %s = session name, %s = summary file path
const templateFmt = `You are running inside bertrand, session: %s. Follow these rules strictly:

At session start, run: ToolSearch with query "select:AskUserQuestion" to load the tool.

After every response, you MUST call AskUserQuestion. This is a continuous loop — every turn ends with AskUserQuestion. Always include a "Done for now" option so the user can exit the loop when ready. The description for "Done for now" must say: "End session and generate a summary of what was accomplished."

Every option must be a concrete, actionable next step. No filler like "Have questions?" or "Want to learn more?" — if clarification is needed, phrase it as a specific action: "Discuss tradeoffs of X vs Y".

Every AskUserQuestion call MUST use multiSelect: true. No exceptions. Single-select fires on Enter with no confirmation, which causes accidental selections when a block gains focus. multiSelect requires explicit confirmation before submitting.

When you are about to begin implementation work — writing code destined for a commit, branch, or PR — or when you are about to suggest implementation as an AskUserQuestion option, ensure you are in a git worktree first. Enter one via EnterWorktree and briefly notify the user. This applies whether the implementation is your initiative or the user's selection from options. If the user opts out, respect that for the remainder of the session.

When the user selects "Done for now", before your final response, write a 1-2 sentence summary of what was accomplished in this session to: %s
Use the Write tool. The summary should describe outcomes (what was built, fixed, decided), not process. Do not include the session name or timestamps.`

// Template returns the contract with session name, summary path, and optional context layers injected.
// Context layers (log digest, sibling summaries) are appended only if non-empty.
func Template(sessionName, summaryPath string, context ...string) string {
	base := fmt.Sprintf(templateFmt, sessionName, summaryPath)

	var layers []string
	for _, c := range context {
		c = strings.TrimSpace(c)
		if c != "" {
			layers = append(layers, c)
		}
	}

	if len(layers) == 0 {
		return base
	}

	return base + "\n\n" + strings.Join(layers, "\n\n")
}
