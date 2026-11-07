package tui

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
)

// slashCommand is one entry in the composer menu. RunBare means Enter can run
// it with no arguments; otherwise Enter only completes the name and waits.
type slashCommand struct {
	Name    string
	Hint    string
	Usage   string
	RunBare bool
}

var slashCommands = []slashCommand{
	{"/help", "显示全部命令", "", true},
	{"/sessions", "打开会话列表", "", true},
	{"/open", "按 ID 打开会话", "会话 ID", false},
	{"/new", "新建会话", "标题", true},
	{"/model", "切换模型，不带参数则列出", "供应商 模型", true},
	{"/reasoning", "思考强度，不带参数则列出", "off|auto|low|medium|high|xhigh|max", true},
	{"/cwd", "切换目录，不带路径则浏览", "路径", true},
	{"/changes", "查看文件改动", "", true},
	{"/rollback", "回退选中的消息", "", true},
	{"/redo", "撤销上一次回退", "", true},
	{"/fork", "从选中的消息分支出去", "", true},
	{"/copy", "复制选中的内容", "", true},
	{"/title", "按对话重新生成标题", "", true},
	{"/todos", "打开任务清单", "", true},
	{"/usage", "用量、速度和 token 统计", "", true},
	{"/rename", "修改标题", "标题", false},
	{"/resume", "继续被中断的助手", "", true},
	{"/refresh", "重新读取历史", "", true},
	{"/quit", "退出", "", true},
}

func commandHelp() string {
	var b strings.Builder
	b.WriteString("命令\n")
	for _, cmd := range slashCommands {
		label := cmd.Name
		if cmd.Usage != "" {
			label += " " + cmd.Usage
		}
		fmt.Fprintf(&b, "%-28s %s\n", label, cmd.Hint)
	}
	b.WriteString(`
输入 / 后会列出命令。方向键选择，Tab 补全，Enter 执行。
Enter 发送；Tab 在输入和消息之间切换；Alt+Enter / Ctrl+J 换行
滚轮、PgUp / PgDn 滚动记录；输入只有一行且没有选项时 ↑↓ 也能滚动
提问若写成 1) 2) 3)，会变成选项：方向键移动，数字键选中，Enter 确认；选「其他」后直接输入
Ctrl+P 会话 · Ctrl+M 模型 · Ctrl+W 目录 · Ctrl+G 改动 · Ctrl+T 任务 · Ctrl+U 用量 · Ctrl+Y 复制
工具跑的时候展开，出结果后收起；点击该行或 Enter 再展开。c 复制这一条的内容和结果
Ctrl+R 显示或收起思考；Esc / Ctrl+C 停止；Ctrl+Q 停止并退出
消息上：c 复制，x 回退，f 分支，r 只恢复这一次工具改的文件，u 撤销回退
审批期间：y 允许一次，a 始终允许（保存全局规则），n 拒绝
同一会话只保留一个实时连接，请关闭网页中该会话的实时页面。`)
	return b.String()
}

func (m *model) slashMatches() []slashCommand {
	if m.focus != focusInput || m.overlay.kind != "" || m.permission != nil {
		return nil
	}
	raw := m.input.Value()
	if raw == m.suggestMute || strings.Contains(raw, "\n") || strings.Contains(raw, " ") || !strings.HasPrefix(raw, "/") {
		return nil
	}
	if m.suggestQuery != raw {
		m.suggestQuery = raw
		m.suggestAt = 0
	}
	var matched []slashCommand
	for _, cmd := range slashCommands {
		if strings.HasPrefix(cmd.Name, raw) {
			matched = append(matched, cmd)
		}
	}
	return matched
}

func (m *model) slashHint() string {
	raw := m.input.Value()
	if m.focus != focusInput || m.overlay.kind != "" || strings.Contains(raw, "\n") || !strings.Contains(raw, " ") {
		return ""
	}
	name, args, _ := strings.Cut(raw, " ")
	if strings.TrimSpace(args) != "" {
		return ""
	}
	for _, cmd := range slashCommands {
		if cmd.Name == name && cmd.Usage != "" {
			return "参数  " + cmd.Usage
		}
	}
	return ""
}

func (m *model) slashMenu() string {
	matches := m.slashMatches()
	if len(matches) == 0 {
		return ""
	}
	const window = 6
	selected := m.suggestAt
	if selected < 0 || selected >= len(matches) {
		selected = 0
		m.suggestAt = 0
	}
	start := 0
	if len(matches) > window {
		start = selected - window/2
		if start < 0 {
			start = 0
		}
		if start+window > len(matches) {
			start = len(matches) - window
		}
	}
	end := len(matches)
	if end-start > window {
		end = start + window
	}
	width := max(24, m.width-2)
	var b strings.Builder
	for offset, item := range matches[start:end] {
		pointer := "  "
		if start+offset == selected {
			pointer = "> "
		}
		line := fit(pointer+pad(item.Name, 12)+" "+item.Hint, width)
		if start+offset == selected {
			line = accent.Render(line)
		} else {
			line = muted.Render(line)
		}
		if offset > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(line)
	}
	return b.String()
}

func (m *model) suggestKey(key string) (tea.Cmd, bool) {
	matches := m.slashMatches()
	switch key {
	case "up", "down":
		if len(matches) == 0 {
			return nil, false
		}
		if key == "up" {
			m.suggestAt--
			if m.suggestAt < 0 {
				m.suggestAt = len(matches) - 1
			}
		} else {
			m.suggestAt++
			if m.suggestAt >= len(matches) {
				m.suggestAt = 0
			}
		}
		return nil, true
	case "tab":
		if len(matches) == 0 {
			return nil, false
		}
		m.completeSlash(m.picked(matches))
		return nil, true
	case "esc", "escape":
		if len(matches) == 0 {
			return nil, false
		}
		m.suggestMute = m.input.Value()
		return nil, true
	case "enter":
		if len(matches) == 0 {
			return nil, false
		}
		item := m.picked(matches)
		typed := strings.TrimSpace(m.input.Value())
		if typed != item.Name || !item.RunBare {
			if item.RunBare && typed != item.Name {
				m.input.Reset()
				m.suggestMute = ""
				m.suggestQuery = ""
				return m.slash(item.Name), true
			}
			m.completeSlash(item)
			return nil, true
		}
		return nil, false
	default:
		return nil, false
	}
}

func (m *model) picked(matches []slashCommand) slashCommand {
	if m.suggestAt < 0 || m.suggestAt >= len(matches) {
		return matches[0]
	}
	return matches[m.suggestAt]
}

func (m *model) completeSlash(item slashCommand) {
	m.input.SetValue(item.Name + " ")
	m.suggestAt = 0
	m.suggestQuery = ""
	m.suggestMute = ""
}

func pad(text string, width int) string {
	runes := []rune(text)
	if len(runes) >= width {
		return text
	}
	return text + strings.Repeat(" ", width-len(runes))
}

func fit(text string, width int) string {
	runes := []rune(text)
	if len(runes) <= width {
		return text
	}
	if width < 4 {
		return string(runes[:width])
	}
	return string(runes[:width-3]) + "..."
}
