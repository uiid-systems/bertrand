package main

import (
	"fmt"
	"os"

	"github.com/uiid-systems/bertrand/cmd"
)

var version = "dev"

func main() {
	cmd.SetVersion(version)
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(os.Stderr, "bertrand panic: %v\n", r)
			os.Exit(1)
		}
	}()
	cmd.Execute()
}
