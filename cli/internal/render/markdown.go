package render

import (
	"strings"
	"unicode/utf8"

	"charm.land/lipgloss/v2"
)

var (
	headingStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("75"))
	strongStyle  = lipgloss.NewStyle().Bold(true)
	emStyle      = lipgloss.NewStyle().Italic(true)
	codeStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("150"))
	quoteStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("245")).Italic(true)
	ruleStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
)

// Markdown renders a practical subset: headings, lists, quotes, fences,
// inline code, emphasis and links. It does not wrap; the viewport soft-wraps.
func Markdown(src string) string {
	src = Sanitize(strings.ReplaceAll(src, "\r\n", "\n"))
	lines := strings.Split(src, "\n")
	var b strings.Builder
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if strings.HasPrefix(line, "```") {
			lang := strings.TrimSpace(strings.TrimPrefix(line, "```"))
			var code []string
			i++
			for i < len(lines) && !strings.HasPrefix(lines[i], "```") {
				code = append(code, lines[i])
				i++
			}
			writeCode(&b, lang, code)
			continue
		}
		if isRule(line) {
			b.WriteString(ruleStyle.Render("────────"))
			b.WriteByte('\n')
			continue
		}
		if n, text, ok := heading(line); ok {
			_ = n
			b.WriteString(headingStyle.Render(renderInline(text)))
			b.WriteByte('\n')
			continue
		}
		if strings.HasPrefix(line, "> ") || line == ">" {
			text := strings.TrimPrefix(line, ">")
			text = strings.TrimPrefix(text, " ")
			b.WriteString(quoteStyle.Render("│ " + renderInline(text)))
			b.WriteByte('\n')
			continue
		}
		if marker, text, ok := listItem(line); ok {
			b.WriteString(marker)
			b.WriteString(renderInline(text))
			b.WriteByte('\n')
			continue
		}
		if strings.TrimSpace(line) == "" {
			b.WriteByte('\n')
			continue
		}
		para := []string{line}
		for i+1 < len(lines) && strings.TrimSpace(lines[i+1]) != "" && !blockStart(lines[i+1]) {
			i++
			para = append(para, strings.TrimSpace(lines[i]))
		}
		b.WriteString(renderInline(strings.Join(para, " ")))
		b.WriteString("\n\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func writeCode(b *strings.Builder, lang string, lines []string) {
	label := "代码"
	if lang != "" {
		label = lang
	}
	b.WriteString(codeStyle.Render("┌ " + label))
	b.WriteByte('\n')
	if len(lines) == 0 {
		b.WriteString(codeStyle.Render("│"))
		b.WriteByte('\n')
	}
	for _, line := range lines {
		b.WriteString(codeStyle.Render("│ " + line))
		b.WriteByte('\n')
	}
	b.WriteString(codeStyle.Render("└"))
	b.WriteByte('\n')
}

func blockStart(line string) bool {
	if strings.HasPrefix(line, "```") || strings.HasPrefix(line, "> ") || line == ">" || isRule(line) {
		return true
	}
	if _, _, ok := heading(line); ok {
		return true
	}
	if _, _, ok := listItem(line); ok {
		return true
	}
	return false
}

func isRule(line string) bool {
	s := strings.TrimSpace(line)
	return s == "---" || s == "***" || s == "___"
}

func heading(line string) (int, string, bool) {
	n := 0
	for n < len(line) && line[n] == '#' {
		n++
	}
	if n == 0 || n > 6 || n == len(line) || line[n] != ' ' {
		return 0, "", false
	}
	return n, strings.TrimSpace(line[n:]), true
}

func listItem(line string) (string, string, bool) {
	trim := strings.TrimLeft(line, " ")
	indent := len(line) - len(trim)
	if indent > 6 {
		return "", "", false
	}
	pad := strings.Repeat(" ", indent)
	if strings.HasPrefix(trim, "- ") || strings.HasPrefix(trim, "* ") {
		return pad + "• ", trim[2:], true
	}
	for i, r := range trim {
		if r < '0' || r > '9' {
			if r == '.' && i > 0 && strings.HasPrefix(trim[i:], ". ") {
				return pad + trim[:i+1] + " ", trim[i+2:], true
			}
			return "", "", false
		}
	}
	return "", "", false
}

func renderInline(s string) string {
	var b strings.Builder
	rest := s
	for len(rest) > 0 {
		if strings.HasPrefix(rest, "`") {
			if end := strings.IndexByte(rest[1:], '`'); end >= 0 {
				b.WriteString(codeStyle.Render(rest[1 : 1+end]))
				rest = rest[2+end:]
				continue
			}
		}
		if strings.HasPrefix(rest, "**") {
			if end := strings.Index(rest[2:], "**"); end >= 0 {
				b.WriteString(strongStyle.Render(renderInline(rest[2 : 2+end])))
				rest = rest[4+end:]
				continue
			}
		}
		if strings.HasPrefix(rest, "*") {
			if end := strings.Index(rest[1:], "*"); end > 0 {
				b.WriteString(emStyle.Render(renderInline(rest[1 : 1+end])))
				rest = rest[2+end:]
				continue
			}
		}
		if strings.HasPrefix(rest, "[") {
			if labelEnd := strings.Index(rest, "]("); labelEnd > 1 {
				if close := strings.IndexByte(rest[labelEnd+2:], ')'); close >= 0 {
					label := rest[1:labelEnd]
					url := rest[labelEnd+2 : labelEnd+2+close]
					b.WriteString(label)
					b.WriteString(codeStyle.Render(" (" + url + ")"))
					rest = rest[labelEnd+3+close:]
					continue
				}
			}
		}
		r, size := utf8.DecodeRuneInString(rest)
		b.WriteRune(r)
		rest = rest[size:]
	}
	return b.String()
}
