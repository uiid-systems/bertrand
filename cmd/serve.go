package cmd

import (
	"fmt"
	"net/http"

	"github.com/spf13/cobra"
	"github.com/uiid-systems/bertrand/internal/server"
)

var (
	servePort   int
	serveWebDir string
)

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the dashboard HTTP server",
	Long:  "Starts a local HTTP server that exposes session state and logs as JSON APIs for the Wave dashboard widget.",
	RunE: func(cmd *cobra.Command, args []string) error {
		mux := server.New(servePort, serveWebDir)
		addr := fmt.Sprintf("127.0.0.1:%d", servePort)
		fmt.Printf("bertrand serve listening on http://%s\n", addr)
		return http.ListenAndServe(addr, mux)
	},
}

func init() {
	serveCmd.Flags().IntVar(&servePort, "port", server.DefaultPort, "Port to listen on")
	serveCmd.Flags().StringVar(&serveWebDir, "web-dir", "", "Serve dashboard assets from this directory instead of embedded (dev mode)")
	rootCmd.AddCommand(serveCmd)
}
