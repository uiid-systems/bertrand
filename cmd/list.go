package cmd

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/session"
	"github.com/uiid-systems/bertrand/internal/tui"
)

var listAll bool

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "Interactive session picker",
	RunE:  runList,
}

func init() {
	listCmd.Flags().BoolVarP(&listAll, "all", "a", false, "Include archived sessions")
	rootCmd.AddCommand(listCmd)
}

func runList(cmd *cobra.Command, args []string) error {
	sessions, err := session.ListSessions()
	if err != nil {
		return err
	}

	if !listAll {
		filtered := sessions[:0]
		for _, s := range sessions {
			if s.Status != session.StatusArchived {
				filtered = append(filtered, s)
			}
		}
		sessions = filtered
	}

	m := tui.NewListModel(sessions)
	p := tea.NewProgram(m)
	result, err := p.Run()
	if err != nil {
		return err
	}

	list := result.(tui.ListModel)
	chosen := list.Chosen()
	if chosen == "" {
		return nil
	}

	fmt.Printf("Resuming session: %s\n", chosen)
	return resumeSession(chosen)
}
