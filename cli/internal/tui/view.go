package tui

import (
	"encoding/json"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/kernel4632/agent/cli/internal/api"
	"github.com/kernel4632/agent/cli/internal/chat"
)

var accent = lipgloss.NewStyle().Foreground(lipgloss.Color("75")).Bold(true)
var muted = lipgloss.NewStyle().Foreground(lipgloss.Color("245"))

func (m *model) renderConversation(bottom bool) {
	follow := bottom || m.viewport.AtBottom()
	m.syncUsage()
	m.rebuild()
	m.viewport.SetWidth(max(10, m.width-2))
	m.viewport.SetHeight(max(1, m.height-m.chrome()))
	content := ""
	selectedLine := 0
	if m.overlay.kind != "" {
		content = m.overlayText()
	} else {
		content, selectedLine = m.transcriptText()
		if strings.TrimSpace(m.panel) != "" {
			content += "\n\n" + chat.Plain(m.panel)
		}
	}
	m.viewport.SetContent(content)
	switch {
	case m.overlay.kind == "stats":
		m.viewport.GotoTop()
	case m.focus == focusTranscript && m.overlay.kind == "":
		m.viewport.SetYOffset(selectedLine)
	case follow:
		m.viewport.GotoBottom()
	}
}

func (m *model) chrome() int {
	n := 1 + 1 + len(m.composerLines()) + 1 // header, rule, input, footer
	if m.taskLine() != "" {
		n++
	}
	if m.activityLine() != "" {
		n++
	}
	if strings.TrimSpace(m.notice) != "" {
		n++
	}
	if menu := m.slashMenu(); menu != "" {
		n += strings.Count(menu, "\n") + 1
	}
	if m.slashHint() != "" {
		n++
	}
	if rows := m.dockRows(); len(rows) > 0 {
		n += len(rows)
	}
	return n
}

func (m *model) line(text string) string {
	return lipgloss.NewStyle().MaxWidth(max(10, m.width-2)).MaxHeight(1).Render(chat.Plain(text))
}

func (m *model) header() string {
	title := m.session.Title
	if title == "" {
		title = "新对话"
	}
	modelName := strings.Trim(m.session.Provider+"/"+m.session.Model, "/")
	bits := []string{title}
	if modelName != "" {
		bits = append(bits, modelName)
	}
	if m.session.Settings.Reasoning != "" {
		bits = append(bits, m.session.Settings.Reasoning)
	}
	if m.session.Cwd != "" {
		bits = append(bits, m.session.Cwd)
	}
	return accent.Render(m.line(strings.Join(bits, "  ")))
}

func (m *model) taskLine() string {
	if m.overlay.kind == "todos" || len(m.todos) == 0 {
		return ""
	}
	done := 0
	current := ""
	for _, item := range m.todos {
		if item.Status == "completed" {
			done++
		}
		if item.Status == "in_progress" && current == "" {
			current = item.Text
		}
	}
	text := "任务 " + itoa(done) + "/" + itoa(len(m.todos))
	if current != "" {
		text += " · " + current
	}
	return text
}

func (m *model) statsLine() string {
	usage := m.lastUsage
	if usage.Input+usage.Output+usage.CacheRead == 0 {
		return ""
	}
	parts := []string{}
	if limit := m.contextLimit(); limit > 0 && usage.Input > 0 {
		percent := usage.Input * 100 / limit
		if percent == 0 && usage.Input > 0 {
			parts = append(parts, "上下文 <1%")
		} else {
			parts = append(parts, "上下文 "+itoa(percent)+"%")
		}
	}
	parts = append(parts, "入 "+itoa(usage.Input), "出 "+itoa(usage.Output), "缓存 "+itoa(usage.CacheRead))
	if usage.Reasoning > 0 {
		parts = append(parts, "思考 "+itoa(usage.Reasoning))
	}
	if speed := m.speedText(); speed != "" {
		parts = append(parts, speed)
	}
	return strings.Join(parts, " · ")
}

func (m *model) contextLimit() int {
	for _, provider := range m.config.Providers {
		if provider.Name != m.session.Provider {
			continue
		}
		for _, model := range provider.Models {
			if model.ID == m.session.Model {
				return model.Context
			}
		}
	}
	return 0
}

func (m *model) syncUsage() {
	if m.running {
		return
	}
	if usage := usageFromHistory(m.session.History); usage.Input+usage.Output > 0 {
		m.lastUsage = usage
	}
}

func (m *model) activityLine() string {
	if m.permission != nil && m.overlay.kind == "" {
		return ""
	}
	if m.running || m.busy || (m.status != "" && m.status != "就绪") {
		if m.status == "" {
			return "正在运行"
		}
		return m.status
	}
	return ""
}

func (m *model) footer() string {
	var choices []answerChoice
	if m.permission == nil && m.overlay.kind == "" && m.slashMenu() == "" {
		_, choices = m.pendingChoices()
	}
	var left string
	switch {
	case m.slashMenu() != "":
		left = "方向键选择   tab 补全   enter 执行   esc 关闭"
	case m.overlay.kind == "stats":
		left = "esc 关闭   pgup 翻页"
	case m.overlay.kind != "":
		left = "esc 关闭   方向键移动   enter 确认"
	case m.permission != nil:
		left = "y 允许一次   a 始终允许   n 拒绝"
	case len(choices) > 0 && m.choiceWrite:
		left = "直接输入   enter 发送   方向键改选"
	case len(choices) > 0:
		left = "方向键选择   数字键确认   或直接输入"
	case m.pendingQuestion() != "":
		left = "enter 回答   pgup 回看   / 命令"
	case m.focus == focusTranscript:
		left = "j/k 移动   enter 展开   c 复制   x 回退   f 分支   r 恢复文件   esc 返回"
	default:
		left = "enter 发送   / 命令   pgup 回看   ctrl+p 会话   ctrl+m 模型"
	}
	if m.session.Undoable > 0 {
		left += "   /redo"
	}
	if stats := m.statsLine(); stats != "" {
		return stats + "   " + left
	}
	return left
}

func (m *model) View() tea.View {
	width := max(10, m.width-2)
	m.input.SetWidth(width)
	m.syncPlaceholder()

	top := []string{m.header()}
	if task := m.taskLine(); task != "" {
		top = append(top, muted.Render(m.line(task)))
	}
	var below []string
	if activity := m.activityLine(); activity != "" {
		below = append(below, accent.Render(m.line(activity)))
	}
	if notice := strings.TrimSpace(m.notice); notice != "" {
		below = append(below, muted.Render(m.line(notice)))
	}
	if menu := m.slashMenu(); menu != "" {
		below = append(below, strings.Split(menu, "\n")...)
	}
	if hint := m.slashHint(); hint != "" {
		below = append(below, muted.Render(m.line(hint)))
	}
	dock := m.dockRows()
	composer := m.composerLines()
	footer := muted.Render(m.line(m.footer()))
	for m.height-(len(top)+1+len(dock)+len(below)+len(composer)+1) < 2 && len(dock) > 1 {
		dock = shrinkDock(dock)
	}
	for m.height-(len(top)+1+len(dock)+len(below)+len(composer)+1) < 1 && len(below) > 0 {
		below = below[:len(below)-1]
	}
	for m.height-(len(top)+1+len(dock)+len(below)+len(composer)+1) < 1 && len(composer) > 1 {
		composer = composer[:len(composer)-1]
	}
	vpHeight := m.height - (len(top) + 1 + len(dock) + len(below) + len(composer) + 1)
	if vpHeight < 1 {
		vpHeight = 1
	}
	stick := m.viewport.AtBottom()
	m.viewport.SetWidth(width)
	m.viewport.SetHeight(vpHeight)
	if stick {
		m.viewport.GotoBottom()
	} else {
		m.viewport.SetYOffset(m.viewport.YOffset())
	}

	vpAt := len(top)
	lines := append([]string{}, top...)
	lines = append(lines, exactLines(m.viewport.View(), vpHeight)...)
	lines = append(lines, m.rule())
	for _, row := range dock {
		lines = append(lines, row.render())
	}
	lines = append(lines, below...)
	inputAt := len(lines)
	lines = append(lines, composer...)
	lines = append(lines, footer)
	if extra := len(lines) - m.height; extra > 0 {
		cut := len(lines) - (m.height - 1)
		if vpAt >= cut {
			vpAt = vpAt - cut + 1
		} else if vpAt > 0 {
			vpAt = 1
		}
		tail := lines[len(lines)-(m.height-1):]
		lines = append([]string{lines[0]}, tail...)
		inputAt -= extra
		if inputAt < 1 {
			inputAt = 1
		}
	}
	if gap := m.height - len(lines); gap > 0 {
		blank := make([]string, gap)
		at := len(top)
		if at > len(lines) {
			at = len(lines)
		}
		if vpAt >= at {
			vpAt += gap
		}
		lines = append(lines[:at], append(blank, lines[at:]...)...)
		inputAt += gap
	}
	m.frameTop = vpAt
	m.frameVP = vpHeight
	m.statsWidth = 0
	if m.overlay.kind == "" {
		m.statsWidth = lipgloss.Width(m.statsLine())
	}

	view := tea.NewView(strings.Join(lines, "\n"))
	view.AltScreen = true
	view.MouseMode = tea.MouseModeCellMotion
	if m.permission == nil && m.focus == focusInput && m.overlay.kind == "" {
		if cur := m.input.Cursor(); cur != nil {
			cur.Y += inputAt
			if cur.Y >= len(lines) {
				cur.Y = len(lines) - 1
			}
			view.Cursor = cur
		}
	}
	return view
}

func (m *model) rule() string {
	width := max(4, m.width-2)
	hint := ""
	if m.overlay.kind == "" {
		if !m.viewport.AtTop() {
			hint += " pgup "
		}
		if !m.viewport.AtBottom() {
			hint += " pgdn "
		}
	}
	if hint == "" || lipgloss.Width(hint) >= width {
		return muted.Render(strings.Repeat("-", width))
	}
	pad := width - lipgloss.Width(hint)
	left := pad / 2
	return muted.Render(strings.Repeat("-", left) + hint + strings.Repeat("-", pad-left))
}

func (m *model) composerLines() []string {
	text := strings.TrimRight(m.input.View(), "\n")
	if text == "" {
		return []string{""}
	}
	lines := strings.Split(text, "\n")
	limit := max(1, m.input.Height())
	if len(lines) > limit {
		lines = lines[:limit]
	}
	return lines
}

func exactLines(text string, n int) []string {
	text = strings.TrimRight(text, "\n")
	var lines []string
	if text != "" {
		lines = strings.Split(text, "\n")
	}
	if n < 1 {
		n = 1
	}
	if len(lines) > n {
		lines = lines[:n]
	}
	for len(lines) < n {
		lines = append(lines, "")
	}
	return lines
}

func (m *model) syncPlaceholder() {
	var choices []answerChoice
	if m.permission == nil && m.overlay.kind == "" {
		_, choices = m.pendingChoices()
	}
	switch {
	case m.permission != nil && m.permission.permission.Tool == "execute_command":
		m.input.Placeholder = "先确认上面的命令"
	case m.permission != nil:
		m.input.Placeholder = "先确认上面的操作"
	case len(choices) > 0 && m.choiceWrite:
		m.input.Placeholder = "输入你的回答，Enter 发送"
	case len(choices) > 0:
		m.input.Placeholder = "方向键或数字选择，也可直接输入"
	case m.pendingQuestion() != "":
		m.input.Placeholder = "回答上面的问题，Enter 发送"
	default:
		m.input.Placeholder = "输入消息，/ 查看命令"
	}
}

func (m *model) pendingQuestion() string {
	if m.permission != nil || m.overlay.kind != "" {
		return ""
	}
	for i := len(m.blocks) - 1; i >= 0; i-- {
		switch m.blocks[i].kind {
		case "tool", "reasoning", "compact", "approval":
			continue
		case "question":
			return strings.TrimSpace(m.blocks[i].body)
		default:
			return ""
		}
	}
	return ""
}

func (m *model) questionInDock(body string) bool {
	text := strings.TrimSpace(body)
	return text != "" && text == m.pendingQuestion()
}

func (m *model) dockRows() []dockLine {
	if m.overlay.kind != "" {
		return nil
	}
	if m.permission != nil {
		return plainDock(m.confirmDock(m.permission.permission))
	}
	if question := m.pendingQuestion(); question != "" {
		return m.questionRows(question)
	}
	return nil
}

func (m *model) confirmDock(permit api.Permission) string {
	title := "确认 " + permit.Tool
	body := ""
	if permit.Tool == "execute_command" {
		title = "确认执行命令"
		command, cwd := commandFields(permit.Input)
		if strings.TrimSpace(cwd) != "" {
			body = "目录  " + cwd + "\n"
		}
		if strings.TrimSpace(command) == "" {
			command = "(空命令)"
		}
		body += command
	} else {
		_, summary := m.toolLabel(permit.Tool, permit.Input)
		body = summary
		if strings.TrimSpace(body) == "" {
			body = string(permit.Input)
		}
	}
	return m.limitDock(title + "\n" + body + "\n\ny 允许一次   a 始终允许   n 拒绝")
}

func commandFields(raw json.RawMessage) (command, cwd string) {
	var body struct {
		Command string `json:"command"`
		Cwd     string `json:"cwd"`
	}
	if json.Unmarshal(raw, &body) == nil && (body.Command != "" || body.Cwd != "") {
		return body.Command, body.Cwd
	}
	return string(raw), ""
}

func (m *model) limitDock(text string) string {
	lines := wrapLines(text, max(8, m.width-2))
	limit := m.dockLimit()
	if len(lines) > limit {
		extra := len(lines) - (limit - 1)
		lines = append(lines[:limit-1], "… 还有 "+itoa(extra)+" 行")
	}
	return strings.Join(lines, "\n")
}

func (m *model) dockLimit() int {
	room := m.height - 6
	if room < 3 {
		room = 3
	}
	if room > 10 {
		room = 10
	}
	return room
}

func wrapLines(text string, width int) []string {
	width = max(4, width)
	var out []string
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if line == "" {
			out = append(out, "")
			continue
		}
		for line != "" {
			if lipgloss.Width(line) <= width {
				out = append(out, line)
				break
			}
			head, rest := cutWidth(line, width)
			out = append(out, head)
			line = rest
		}
	}
	return out
}

func cutWidth(text string, width int) (string, string) {
	runes := []rune(text)
	used := 0
	for i, r := range runes {
		w := lipgloss.Width(string(r))
		if used+w > width {
			if i == 0 {
				return string(runes[:1]), string(runes[1:])
			}
			return string(runes[:i]), string(runes[i:])
		}
		used += w
	}
	return text, ""
}
