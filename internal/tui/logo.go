package tui

import (
	"fmt"
	"strings"
)

var Version = "dev"

// SetVersion sets the display version for the logo.
func SetVersion(v string) { Version = v }

var logoLines = []string{
	` .o8                              .                                        .o8 `,
	`"888                            .o8                                       "888 `,
	` 888oooo.   .ooooo.  oooo d8b .o888oo oooo d8b  .oooo.   ooo. .oo.    .oooo888 `,
	` d88' ` + "`" + `88b d88' ` + "`" + `88b ` + "`" + `888""8P   888   ` + "`" + `888""8P ` + "`" + `P  )88b  ` + "`" + `888P"Y88b  d88' ` + "`" + `888 `,
	` 888   888 888ooo888  888       888    888      .oP"888   888   888  888   888 `,
	` 888   888 888    .o  888       888 .  888     d8(  888   888   888  888   888 `,
	` ` + "`" + `Y8bod8P' ` + "`" + `Y8bod8P' d888b      "888" d888b    ` + "`" + `Y888""8o o888o o888o ` + "`" + `Y8bod88P"`,
}

// Green gradient: light → dark (256-color ANSI)
var greenGradient = []int{120, 114, 78, 72, 34, 28, 22}

func Logo() string {
	var b strings.Builder
	b.WriteString("\n\n")
	for i, line := range logoLines {
		color := greenGradient[i]
		fmt.Fprintf(&b, "\033[38;5;%dm%s\033[0m\n", color, line)
	}
	b.WriteString("\n")
	fmt.Fprintf(&b, "\033[38;5;241m  Multi-session workflow manager for Claude Code\033[0m\n")
	fmt.Fprintf(&b, "\033[38;5;243m  v%s · https://github.com/uiid-systems/bertrand\033[0m\n", Version)
	b.WriteString("\n")
	return b.String()
}

var goodbyeLines = []string{
	`                                     .o8   .o8                             .o.  `,
	`                                    "888  "888                             888  `,
	` .oooooooo  .ooooo.   .ooooo.   .oooo888   888oooo.  oooo    ooo  .ooooo.  888  `,
	`888' ` + "`" + `88b  d88' ` + "`" + `88b d88' ` + "`" + `88b d88' ` + "`" + `888   d88' ` + "`" + `88b  ` + "`" + `88.  .8'   d88' ` + "`" + `88b Y8P  `,
	`888   888  888   888 888   888 888   888   888   888   ` + "`" + `88..8'   888ooo888 ` + "`" + `8'  `,
	"`88bod8P'  888   888 888   888 888   888   888   888    `888'    888    .o .o.  ",
	"`8oooooo.  `Y8bod8P' `Y8bod8P' `Y8bod88P\"  `Y8bod8P'     .8'     `Y8bod8P' Y8P  ",
	`d"     YD                                            .o..P'                     `,
	`"Y88888P'                                            ` + "`" + `Y8P'                      `,
}

// Reversed green gradient: dark → light (256-color ANSI)
var greenGradientReversed = []int{22, 22, 28, 34, 72, 78, 114, 114, 120}

func Goodbye() string {
	var b strings.Builder
	b.WriteString("\n\n")
	for i, line := range goodbyeLines {
		color := greenGradientReversed[i]
		fmt.Fprintf(&b, "\033[38;5;%dm%s\033[0m\n", color, line)
	}
	b.WriteString("\n")
	return b.String()
}
