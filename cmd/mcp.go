package cmd

import (
	"os"

	"github.com/spf13/cobra"
	bertrandmcp "github.com/uiid-systems/bertrand/internal/mcp"
)

var mcpCmd = &cobra.Command{
	Use:   "mcp",
	Short: "Run MCP server (stdio transport)",
	Long:  "Starts a bertrand MCP server over stdio, exposing session data as resources and tools for Claude Code.",
	RunE: func(cmd *cobra.Command, args []string) error {
		return bertrandmcp.Serve(os.Stdin, os.Stdout)
	},
}

func init() {
	rootCmd.AddCommand(mcpCmd)
}
