/*
界面骨架：顶栏、对话区、输入行和底栏。
顶栏左边是标题和模型，右边是缩短后的目录。底栏左边是用量（点击打开统计），右边是当前快捷键。
运行时的步骤写在输入行上方，带已用秒数，不写进对话记录。
*/
package tui

import (
	"encoding/json"
	"os"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/kernel4632/agent/cli/internal/api"
	"github.com/kernel4632/agent/cli/internal/chat"
)

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
	case m.readingOverlay():
		m.viewport.GotoTop() // 说明和用量从第一行看起，不跟到末尾
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
	width := max(10, m.width-2) // 和对话区同一宽度，多一列就会把这一行挤成两行
	title := oneLine(chat.Plain(m.session.Title), 200)
	if title == "" {
		title = "新对话"
	}
	meta := strings.Trim(m.session.Provider+"/"+m.session.Model, "/")
	if reasoning := strings.TrimSpace(m.session.Settings.Reasoning); reasoning != "" {
		if meta != "" {
			meta += " · "
		}
		meta += reasoning
	}
	cwd := shortPath(m.session.Cwd, max(8, width/3)) // 家目录收成 ~，放不下就留目录末尾
	cwdW := lipgloss.Width(cwd)
	gap := 0
	if cwdW > 0 {
		gap = 2
	}
	budget := width - cwdW - gap
	if budget < 4 && cwdW > 0 {
		cwd = clipCols(cwd, max(4, width/2))
		cwdW = lipgloss.Width(cwd)
		gap = 2
		budget = width - cwdW - gap
	}
	if budget < 1 {
		budget = width
		cwd, cwdW, gap = "", 0, 0
	}
	title = clipCols(title, budget)
	metaShown := ""
	if room := budget - lipgloss.Width(title) - 2; meta != "" && room >= 4 {
		metaShown = clipCols(meta, room) // 宽度不够时先丢掉模型，目录比模型更常被用到
	}
	var b strings.Builder
	b.WriteString(accent.Render(title))
	used := lipgloss.Width(title)
	if metaShown != "" {
		piece := "  " + metaShown
		b.WriteString(gold.Render(piece))
		used += lipgloss.Width(piece)
	}
	if cwdW > 0 {
		pad := width - used - cwdW
		if pad < gap {
			pad = gap
		}
		b.WriteString(strings.Repeat(" ", pad))
		b.WriteString(dim.Render(cwd))
	}
	return b.String()
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

// statsLine 返回底栏用量：已上色的文本和同一份内容的纯文本。
// 纯文本留着算宽度和判断点击落在哪，颜色只影响观感。
func (m *model) statsLine() (string, string) {
	usage := m.lastUsage
	if usage.Input+usage.Output+usage.CacheRead == 0 {
		return "", ""
	}
	var colored, plain []string
	add := func(style lipgloss.Style, text string) {
		colored = append(colored, style.Render(text))
		plain = append(plain, text)
	}
	if limit := m.contextLimit(); limit > 0 && usage.Input > 0 {
		percent := usage.Input * 100 / limit
		label := "上下文 " + itoa(percent) + "%"
		if percent == 0 {
			label = "上下文 <1%"
		}
		bar := meter(percent, 8)
		colored = append(colored, muted.Render(label)+" "+contextBar(percent).Render(bar)) // 颜色自己会说还剩多少
		plain = append(plain, label+" "+bar)
	}
	add(muted, "入 "+itoa(usage.Input))
	add(muted, "出 "+itoa(usage.Output))
	add(muted, "缓存 "+itoa(usage.CacheRead))
	if usage.Reasoning > 0 {
		add(muted, "思考 "+itoa(usage.Reasoning))
	}
	if speed := m.speedText(); speed != "" {
		add(gold, speed)
	}
	return strings.Join(colored, dim.Render(" · ")), strings.Join(plain, " · ")
}

// contextBar 选用量条的颜色：85% 前是完成绿，85% 起琥珀，95% 起警报红。
func contextBar(percent int) lipgloss.Style {
	switch {
	case percent >= 95:
		return errText
	case percent >= 85:
		return warnText
	default:
		return okText
	}
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
		return "" // 批准卡已经占住输入行上方，再写一行状态就是重复
	}
	text := m.activityText()
	if text == "" {
		return ""
	}
	if m.running && !m.turnAt.IsZero() {
		if elapsed := int(time.Since(m.turnAt).Seconds()); elapsed >= 1 {
			text = itoa(elapsed) + "s  " + text // 秒数放前面：窄屏裁掉的是后半，时钟还在
		}
	}
	if m.running {
		text = spinnerFrames[m.spin%len(spinnerFrames)] + " " + text // 转圈在最前面，一眼看出还在动
	}
	return text
}

func (m *model) activityText() string {
	switch m.status {
	case "连接中断，正在重新读取历史…", "模型请求重试中…", "正在压缩上下文…", "上下文已压缩", "等待工具审批":
		return m.status
	}
	if m.running {
		for i := len(m.steps) - 1; i >= 0; i-- {
			tool := m.steps[i].tool
			if tool == nil || !tool.running {
				continue
			}
			title, summary := m.toolLabel(tool.name, tool.input)
			if summary != "" && summary != title {
				return title + "  " + oneLine(summary, 48)
			}
			if title == "" {
				return "正在执行工具"
			}
			return title
		}
		if strings.TrimSpace(m.liveReasoning) != "" && strings.TrimSpace(m.liveText) == "" {
			return "正在思考…"
		}
		if strings.TrimSpace(m.liveText) != "" {
			return "正在回复…"
		}
		if m.status != "" && m.status != "就绪" && m.status != "正在运行…" {
			return m.status
		}
		return "正在请求模型…"
	}
	if m.busy {
		return "" // 命令进行中由提示行写「处理中…」；这里若回写状态，空闲时的「就绪」会盖住它
	}
	if m.status != "" && m.status != "就绪" {
		return m.status
	}
	return ""
}

// footer 返回底栏：左边用量，右边当前可用的快捷键。
// 两个返回值分别是上色后的文本和纯文本，后者用来判断点击落在用量还是快捷键上。
func (m *model) footer() (string, string) {
	width := max(10, m.width-2)
	stats, plainStats := m.statsLine()
	if stats == "" {
		hint := clipCols(m.footerHint(2), width)
		return dim.Render(hint), hint
	}
	for level := 2; level >= 0; level-- { // 先试完整快捷键，放不下就缩短，绝不截成半个词
		hint := m.footerHint(level)
		if lipgloss.Width(stats)+2+lipgloss.Width(hint) <= width {
			return spread(stats, dim.Render(hint), width), spread(plainStats, hint, width)
		}
	}
	clipped := clipCols(plainStats, width)
	return muted.Render(clipped), clipped // 用量自己已经占满：它能点开统计，快捷键仍在 /help
}

func (m *model) footerHint(level int) string {
	var choices []answerChoice
	if m.permission == nil && m.overlay.kind == "" && m.slashMenu() == "" {
		_, choices = m.pendingChoices()
	}
	var hint string
	switch {
	case m.slashMenu() != "":
		hint = "方向键选择   tab 补全   enter 执行   esc 关闭"
	case m.readingOverlay():
		hint = "esc 关闭   pgup 翻页"
	case m.overlay.kind != "":
		hint = "esc 关闭   方向键移动   enter 确认"
	case m.permission != nil:
		hint = "y 允许   n 拒绝"
	case len(choices) > 0 && m.choiceWrite:
		hint = "直接输入   enter 发送   方向键改选"
	case len(choices) > 0:
		hint = "方向键选择   数字键确认   或直接输入"
	case m.pendingQuestion() != "":
		hint = "enter 回答   pgup 回看   / 命令"
	case m.focus == focusTranscript:
		if level >= 2 {
			hint = "j/k 移动   enter 展开   c 复制   x 回退   f 分支   r 恢复文件   esc 返回"
		} else if level == 1 {
			hint = "j/k 移动   enter 展开   esc 返回"
		} else {
			hint = "j/k 移动   esc 返回"
		}
	default:
		switch level {
		case 0:
			hint = "enter 发送   / 命令"
		case 1:
			hint = "enter 发送   / 命令   ctrl+p 会话"
		default:
			hint = "enter 发送   / 命令   pgup 回看   ctrl+p 会话   ctrl+m 模型"
		}
	}
	if m.session.Undoable > 0 && level >= 2 {
		hint += "   /redo"
	}
	return hint
}

func (m *model) View() tea.View {
	width := max(10, m.width-2)
	m.input.SetWidth(m.inputWidth())
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
	footer, plainFooter := m.footer()
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
		_, plainStats := m.statsLine()
		if plainStats != "" && strings.HasPrefix(plainFooter, plainStats) {
			m.statsWidth = lipgloss.Width(plainStats) // 只覆盖用量前缀，点到右边的快捷键不打开统计
		} else if plainStats != "" {
			m.statsWidth = lipgloss.Width(plainFooter)
		}
	}

	body := strings.Join(lines, "\n")
	if m.paint%2 == 1 {
		body += "\u200b" // 内容没变时终端不重绘；回来时翻一下，把被盖住的画面画回来
	}
	view := tea.NewView(body)
	view.AltScreen = true
	view.MouseMode = tea.MouseModeCellMotion
	view.ReportFocus = true // 离开再回来时收到焦点消息，用来重绘并接上还在跑的会话
	if m.permission == nil && m.focus == focusInput && m.overlay.kind == "" {
		if cur := m.input.Cursor(); cur != nil {
			cur.X += m.composerOffset() // 输入框左边多了一条竖线，光标跟着右移
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
		return hairline.Render(strings.Repeat("─", width))
	}
	pad := width - lipgloss.Width(hint)
	left := pad / 2
	return hairline.Render(strings.Repeat("─", left) + hint + strings.Repeat("─", pad-left))
}

const (
	composerGutter = 2  // 左右竖线各占一列，再用一列和文字隔开
	composerMin    = 24 // 再窄就只剩竖线，放弃边框保住输入宽度
)

// composerLines 是输入区的实际画面：左右各一条竖线把输入框收住，聚焦时用强调蓝。
// 只画左右、不画上下：多行输入不会多占行，矮终端里对话区不会被挤没。
func (m *model) composerLines() []string {
	text := strings.TrimRight(m.input.View(), "\n")
	var lines []string
	if text != "" {
		lines = strings.Split(text, "\n")
	}
	limit := max(1, m.input.Height())
	if len(lines) > limit {
		lines = lines[:limit]
	}
	if len(lines) == 0 {
		lines = []string{""}
	}
	if !m.composerBordered() {
		return lines
	}
	bar := hairline
	if m.input.Focused() {
		bar = accent
	}
	width := m.inputWidth()
	rows := make([]string, len(lines))
	for i, line := range lines {
		if pad := width - lipgloss.Width(line); pad > 0 {
			line += strings.Repeat(" ", pad) // 补到满宽，右边那条竖线才会落在同一列
		}
		rows[i] = bar.Render("┃") + " " + line + " " + bar.Render("┃")
	}
	return rows
}

func (m *model) composerBordered() bool {
	return max(10, m.width-2) >= composerMin
}

// inputWidth 是输入区自己能用的列数，四周的竖线和空格先让出来。
func (m *model) inputWidth() int {
	outer := max(10, m.width-2)
	if !m.composerBordered() {
		return outer
	}
	return outer - composerGutter*2
}

// composerOffset 是输入文字相对屏幕左边的位移，光标要用它对齐。
func (m *model) composerOffset() int {
	if !m.composerBordered() {
		return 0
	}
	return composerGutter
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
	return m.limitDock(title + "\n" + body) // 按键提示只在底栏出现一次，这里不重复
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

func spread(left, right string, width int) string {
	pad := width - lipgloss.Width(left) - lipgloss.Width(right)
	if pad < 2 {
		pad = 2
	}
	return left + strings.Repeat(" ", pad) + right
}

func clipCols(text string, width int) string {
	if text == "" || width < 1 {
		return ""
	}
	if lipgloss.Width(text) <= width {
		return text
	}
	if width == 1 {
		head, _ := cutWidth(text, 1)
		return head
	}
	head, _ := cutWidth(text, width-1) // 少一列留给省略号，避免刚好卡在双宽字符上
	return head + "…"
}

func shortPath(path string, limit int) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		if path == home {
			path = "~"
		} else if rest, ok := strings.CutPrefix(path, home); ok && (strings.HasPrefix(rest, "/") || strings.HasPrefix(rest, "\\")) {
			path = "~" + rest // 只在家目录边界替换，避免把名字碰巧相同的目录也收掉
		}
	}
	if limit < 4 || lipgloss.Width(path) <= limit {
		return path
	}
	ellipsis := "…"
	room := limit - lipgloss.Width(ellipsis)
	runes := []rune(path)
	for len(runes) > 0 && lipgloss.Width(string(runes)) > room {
		runes = runes[1:] // 从左边裁：最后一级目录比家目录前缀有用
	}
	return ellipsis + string(runes)
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

// itoa 把计数换成文字；界面里到处在拼短句子，单独包一层比每次写 strconv 省事。
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [16]byte
	i := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
