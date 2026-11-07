package tui

import (
	"regexp"
	"strconv"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// choiceMark matches "1)" / "2." / "3、" / "A)" after a line break or a colon/semicolon.
// A space alone is not a separator, so "Go 1.26" and "第 1) 步" stay prose.
var choiceMark = regexp.MustCompile(`(?:^|[\n；;：:])\s*([1-9][0-9]?|[A-Da-d])\s*[)）.、．.]\s*`)

type answerChoice struct {
	key  string
	text string
	free bool
}

type dockLine struct {
	text  string
	style string // title, chosen, option, muted, or empty for plain stem text
}

func (row dockLine) render() string {
	switch row.style {
	case "title", "chosen":
		return accent.Render(row.text)
	case "muted":
		return muted.Render(row.text)
	default:
		return row.text
	}
}

func parseChoices(question string) (string, []answerChoice) {
	question = strings.ReplaceAll(question, "\r\n", "\n")
	marks := choiceMark.FindAllStringSubmatchIndex(question, -1)
	if len(marks) < 2 {
		return "", nil
	}
	keys := make([]string, len(marks))
	for i, mark := range marks {
		keys[i] = strings.ToUpper(question[mark[2]:mark[3]])
	}
	if !sequentialKeys(keys) {
		return "", nil
	}
	choices := make([]answerChoice, len(marks))
	for i, mark := range marks {
		end := len(question)
		if i+1 < len(marks) {
			end = marks[i+1][0]
		}
		text := strings.Join(strings.Fields(question[mark[1]:end]), " ")
		text = strings.Trim(text, "。；;，, ")
		if text == "" {
			return "", nil
		}
		choices[i] = answerChoice{key: keys[i], text: text, free: freeChoice(text)}
	}
	return cleanStem(question[:marks[0][0]]), choices
}

func sequentialKeys(keys []string) bool {
	if len(keys) < 2 || len(keys) > 12 {
		return false
	}
	if keys[0][0] >= '1' && keys[0][0] <= '9' {
		for i, key := range keys {
			n, err := strconv.Atoi(key)
			if err != nil || n != i+1 {
				return false
			}
		}
		return true
	}
	for i, key := range keys {
		if len(key) != 1 || key[0] != byte('A'+i) {
			return false
		}
	}
	return true
}

func freeChoice(text string) bool {
	switch text {
	case "其他", "其它", "自定义", "自己输入", "手动输入":
		return true
	}
	if strings.HasPrefix(text, "其他") || strings.HasPrefix(text, "其它") {
		for _, word := range []string{"指定", "输入", "填写", "自定义", "说明", "自己"} {
			if strings.Contains(text, word) {
				return true
			}
		}
	}
	return false
}

func cleanStem(stem string) string {
	stem = strings.TrimSpace(stem)
	stem = strings.TrimRight(stem, "：:，,。；; \n\t")
	for _, suffix := range []string{"比如说", "比如", "例如", "如下", "可以是", "可以选择", "可选"} {
		if strings.HasSuffix(stem, suffix) {
			stem = strings.TrimSpace(strings.TrimSuffix(stem, suffix))
			stem = strings.TrimRight(stem, "：:，,。；; ")
		}
	}
	return strings.TrimSpace(stem)
}

func (m *model) pendingChoices() (string, []answerChoice) {
	question := m.pendingQuestion()
	if question != m.choiceFor {
		m.choiceFor = question
		m.choiceAt = 0
		m.choiceWrite = false
	}
	stem, choices := parseChoices(question)
	if len(choices) == 0 {
		return "", nil
	}
	if m.choiceAt < 0 || m.choiceAt >= len(choices) {
		m.choiceAt = 0
	}
	return stem, choices
}

func plainDock(text string) []dockLine {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	parts := strings.Split(text, "\n")
	rows := make([]dockLine, len(parts))
	for i, line := range parts {
		rows[i].text = line
	}
	rows[0].style = "title"
	return rows
}

func (m *model) questionRows(question string) []dockLine {
	stem, choices := m.pendingChoices()
	if len(choices) == 0 {
		return plainDock(m.limitDock("需要你回答\n" + question))
	}
	width := max(16, m.width-2)
	limit := m.dockLimit()
	opts := m.choiceRows(choices, width)
	rows := []dockLine{{text: "请选择", style: "title"}}
	budget := limit - 1 - len(opts)
	blank := false
	if stem != "" && budget >= 2 {
		blank = true
		budget--
	}
	if budget < 0 {
		budget = 0
		if keep := max(1, limit-1); len(opts) > keep {
			opts = opts[:keep]
		}
	}
	if stem != "" && budget > 0 {
		wrapped := wrapLines(stem, width)
		if len(wrapped) > budget {
			wrapped = wrapped[:budget]
			wrapped[len(wrapped)-1] = clipEllipsis(wrapped[len(wrapped)-1], width)
		}
		for _, line := range wrapped {
			rows = append(rows, dockLine{text: line})
		}
	}
	if blank && len(rows)+len(opts) < limit {
		rows = append(rows, dockLine{})
	}
	rows = append(rows, opts...)
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows
}

func (m *model) choiceRows(choices []answerChoice, width int) []dockLine {
	keyWidth := 1
	for _, choice := range choices {
		if w := lipgloss.Width(choice.key); w > keyWidth {
			keyWidth = w
		}
	}
	var rows []dockLine
	for i, choice := range choices {
		mark := "  "
		style := "option"
		if i == m.choiceAt {
			mark = "> "
			style = "chosen"
		}
		head := mark + strings.Repeat(" ", max(0, keyWidth-lipgloss.Width(choice.key))) + choice.key + "  "
		bodyWidth := max(4, width-lipgloss.Width(head))
		wrapped := wrapLines(choice.text, bodyWidth)
		if len(wrapped) == 0 {
			wrapped = []string{""}
		}
		rows = append(rows, dockLine{text: head + wrapped[0], style: style})
		indent := strings.Repeat(" ", lipgloss.Width(head))
		for _, extra := range wrapped[1:] {
			rows = append(rows, dockLine{text: indent + extra, style: style})
		}
	}
	return rows
}

func clipEllipsis(text string, width int) string {
	ellipsis := "…"
	room := width - lipgloss.Width(ellipsis)
	if room < 1 || lipgloss.Width(text) <= width {
		return text
	}
	return trimWidth(text, room) + ellipsis
}

func trimWidth(text string, width int) string {
	if lipgloss.Width(text) <= width {
		return text
	}
	head, _ := cutWidth(text, max(1, width))
	return strings.TrimRight(head, " ")
}

func shrinkDock(dock []dockLine) []dockLine {
	if len(dock) <= 1 {
		return dock
	}
	for i := 1; i < len(dock); i++ {
		if dock[i].style == "" && dock[i].text != "" {
			return dropDock(dock, i)
		}
	}
	for i := 1; i < len(dock); i++ {
		if dock[i].text == "" {
			return dropDock(dock, i)
		}
	}
	return dock[:len(dock)-1]
}

func dropDock(dock []dockLine, i int) []dockLine {
	next := make([]dockLine, 0, len(dock)-1)
	next = append(next, dock[:i]...)
	return append(next, dock[i+1:]...)
}

func (m *model) choiceKey(key string) (tea.Cmd, bool) {
	if m.focus != focusInput || m.slashMenu() != "" || m.overlay.kind != "" || m.permission != nil {
		return nil, false
	}
	_, choices := m.pendingChoices()
	if len(choices) < 2 {
		return nil, false
	}
	typed := strings.TrimSpace(m.input.Value())
	switch key {
	case "up", "down":
		if typed != "" {
			return nil, false
		}
		m.choiceWrite = false
		if key == "up" && m.choiceAt > 0 {
			m.choiceAt--
		}
		if key == "down" && m.choiceAt < len(choices)-1 {
			m.choiceAt++
		}
		return nil, true
	case "enter":
		if typed != "" {
			return nil, false
		}
		return m.activateChoice(choices[m.choiceAt])
	}
	if typed != "" || m.choiceWrite || len(key) != 1 {
		return nil, false
	}
	for i, choice := range choices {
		if strings.EqualFold(choice.key, key) {
			m.choiceAt = i
			return m.activateChoice(choice)
		}
	}
	return nil, false
}

func (m *model) activateChoice(choice answerChoice) (tea.Cmd, bool) {
	if choice.free {
		m.choiceWrite = true
		return m.input.Focus(), true
	}
	m.choiceWrite = false
	m.input.Reset()
	return m.begin("send", choice.text), true
}
