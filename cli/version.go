// Package cli contains the version shared by the command and release builds.
package cli

import (
	_ "embed"
	"strings"
)

//go:embed VERSION
var version string

func Version() string { return strings.TrimSpace(version) }
