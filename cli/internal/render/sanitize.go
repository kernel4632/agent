package render

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// Sanitize keeps newlines, tabs and color (SGR) sequences, and drops every
// other control sequence so tool output cannot move the cursor or clear the screen.
func Sanitize(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == '\n' || r == '\t' {
			b.WriteRune(r)
			i += size
			continue
		}
		if r == 0x1b {
			if seq, ok := sgr(s[i:]); ok {
				b.WriteString(seq)
				i += len(seq)
				continue
			}
			i += len(skipEscape(s[i:]))
			continue
		}
		if unicode.IsControl(r) {
			i += size
			continue
		}
		b.WriteRune(r)
		i += size
	}
	return b.String()
}

func sgr(s string) (string, bool) {
	if len(s) < 3 || s[0] != 0x1b || s[1] != '[' {
		return "", false
	}
	for i := 2; i < len(s); i++ {
		switch {
		case s[i] == 'm':
			return s[:i+1], true
		case s[i] >= '0' && s[i] <= '9', s[i] == ';':
		default:
			return "", false
		}
	}
	return "", false
}

func skipEscape(s string) string {
	if len(s) == 0 {
		return s
	}
	if len(s) >= 2 && s[1] == ']' {
		for i := 2; i < len(s); i++ {
			if s[i] == 0x07 || (s[i] == '\\' && i > 2 && s[i-1] == 0x1b) {
				return s[:i+1]
			}
		}
		return s
	}
	if len(s) >= 2 && s[1] == '[' {
		for i := 2; i < len(s); i++ {
			if s[i] >= 0x40 && s[i] <= 0x7e {
				return s[:i+1]
			}
		}
		return s
	}
	if len(s) == 1 {
		return s
	}
	return s[:2]
}
