package contract

import (
	"fmt"
	"strings"
)

// Template is the base contract. The session name gets injected at launch time.
const templateFmt = `You are running inside bertrand, session: %s. Follow these rules strictly:

At session start, run: ToolSearch with query "select:AskUserQuestion" to load the tool.

After every response, you MUST call AskUserQuestion. The question field MUST start with "%s »" followed by your actual question. This is a continuous loop — every turn ends with AskUserQuestion. Always include a "Done for now" option so the user can exit the loop when ready.

Every option must be a concrete, actionable next step. No filler like "Have questions?" or "Want to learn more?" — if clarification is needed, phrase it as a specific action: "Discuss tradeoffs of X vs Y".

Default to multiSelect: true. Most questions benefit from letting the user pick multiple options. Only use single-select (multiSelect: false) when the choices are truly mutually exclusive and exactly one path must be chosen (e.g., "which database?" or "rename to A or B?").`

// Template returns the contract with session name and optional context layers injected.
// Context layers (log digest, sibling summaries) are appended only if non-empty.
func Template(sessionName string, context ...string) string {
	base := fmt.Sprintf(templateFmt, sessionName, sessionName)

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
