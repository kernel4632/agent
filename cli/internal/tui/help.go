/*
命令说明页：斜杠命令、快捷键和几条使用约定。
slashCommands 清单在 suggest.go，这里只负责把它排成两栏。
*/
package tui

import (
	"strings"

	"charm.land/lipgloss/v2"
)

func (m *model) openHelp() {
	m.overlay = overlayState{kind: "help"} // 只盖住对话，不擦掉刚才那条命令结果
	m.focus = focusOverlay
	m.input.Blur()
	m.renderConversation(true)
}

func (m *model) helpText() string {
	width := max(20, m.width-2)
	var b strings.Builder
	write := func(text string) {
		b.WriteString(muted.Render(clipCols(text, width))) // 先裁纯文本再上色，避免把转义码切成两半
		b.WriteByte('\n')
	}
	b.WriteString(accent.Render("命令"))
	b.WriteByte('\n')
	write("用命令名或中文说明筛选，例如 /用量")
	b.WriteByte('\n')
	for _, cmd := range slashCommands {
		gap := 16 - lipgloss.Width(cmd.Name)
		if gap < 2 {
			gap = 2
		}
		room := width - lipgloss.Width(cmd.Name) - gap
		if room < 1 {
			b.WriteString(accent.Render(clipCols(cmd.Name, width)))
		} else {
			b.WriteString(accent.Render(cmd.Name))
			b.WriteString(strings.Repeat(" ", gap))
			b.WriteString(clipCols(cmd.Hint, room))
		}
		b.WriteByte('\n')
		if cmd.Usage != "" {
			write(strings.Repeat(" ", 16) + cmd.Usage)
		}
	}
	b.WriteByte('\n')
	for _, line := range []string{
		"方向键选择，Tab 补全，Enter 执行不需要参数的命令",
		"Enter 发送；Tab 在输入和消息之间切换；Alt+Enter / Ctrl+J 换行",
		"滚轮、PgUp / PgDn 滚动记录；输入只有一行且没有选项时 ↑↓ 也能滚动",
		"提问若写成 1) 2) 3)，会变成选项：方向键移动，数字键选中，Enter 确认",
		"Ctrl+P 会话 · Ctrl+M 模型 · Ctrl+W 目录 · Ctrl+G 改动 · Ctrl+T 任务 · Ctrl+U 用量 · Ctrl+Y 复制",
		"连续的工具收成一行，回答留在对话里；点击该行或 Enter 再展开",
		"Ctrl+R 显示或收起思考；Esc / Ctrl+C 停止；Ctrl+Q 停止并退出",
		"消息上：c 复制，x 回退，f 分支，r 只恢复这一次工具改的文件，u 撤销回退",
		"审批期间：y 允许这次，n 拒绝（长期规则去「工具自动批准」里设）",
		"同一会话只保留一个实时连接，请关闭网页中该会话的实时页面",
		"从别的界面回到这里时，会重新接上还在跑的会话",
	} {
		write(line)
	}
	return strings.TrimRight(b.String(), "\n")
}
