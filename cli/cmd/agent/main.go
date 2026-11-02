package main

import (
	"fmt"
	"os"

	"github.com/kernel4632/agent/cli/internal/command"
)

func main() {
	if err := command.New().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "错误:", err)
		os.Exit(1)
	}
}
