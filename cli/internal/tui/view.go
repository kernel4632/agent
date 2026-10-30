package tui

import (
	"encoding/json"
	"fmt"
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
	var content strings.Builder
	for _, message := range m.session.History {
		text := chat.MessageText(message, m.showReasoning)
		var parts []api.Part
		_ = json.Unmarshal(message.Content, &parts)
		for _, part := range parts {
			if part.Type == "tool-call" && part.ToolName != "attempt_completion" && part.ToolName != "ask_followup_question" {
				text += "\n[工具] " + part.ToolName + " " + string(part.Input)
			}
		}
		role := map[string]string{"user": "你", "assistant": "Agent", "tool": "工具结果"}[message.Role]
		if message.Role == "tool" {
			for _, part := range parts {
				if part.ToolName == "attempt_completion" || part.ToolName == "ask_followup_question" {
					continue
				}
				text += part.ToolName + "\n" + chat.Output(part.Output) + "\n"
			}
		}
		if strings.TrimSpace(text) != "" {
			fmt.Fprintf(&content, "%s\n%s\n\n", accent.Render(role), chat.Plain(text))
		}
		if len(message.Usage) > 0 {
			var usage struct{ Input, Output, CacheRead int }
			if json.Unmarshal(message.Usage, &usage) == nil {
				fmt.Fprintln(&content, muted.Render(fmt.Sprintf("输入 %d · 输出 %d · 缓存 %d tokens\n", usage.Input, usage.Output, usage.CacheRead)))
			}
		}
	}
	if m.showReasoning && m.liveReasoning != "" {
		fmt.Fprintf(&content, "%s\n%s\n\n", muted.Render("思考"), chat.Plain(m.liveReasoning))
	}
	content.WriteString(chat.Plain(m.liveLog))
	if m.liveText != "" {
		fmt.Fprintf(&content, "\n%s\n%s\n", accent.Render("Agent"), chat.Plain(m.liveText))
	}
	if m.permission != nil {
		p := m.permission.permission
		fmt.Fprintf(&content, "\n%s\n%s\n%s\n\n", accent.Render("工具审批"), chat.Plain(p.Tool), chat.Plain(string(p.Input)))
	}
	if m.panel != "" {
		content.WriteString("\n" + chat.Plain(m.panel) + "\n")
	}
	m.viewport.SetContent(content.String())
	if follow {
		m.viewport.GotoBottom()
	}
}

func (m *model) View() tea.View {
	width := max(10, m.width-2)
	line := func(text string) string {
		return lipgloss.NewStyle().MaxWidth(width).MaxHeight(1).Render(chat.Plain(text))
	}
	header := accent.Render(line("Agent · "+m.session.Title)) + "\n" + muted.Render(line(m.session.ID+" · "+m.session.Provider+"/"+m.session.Model+" · "+m.session.Settings.Reasoning)) + "\n" + muted.Render(line(m.session.Cwd))
	status := line(m.status)
	if m.permission != nil {
		status = "y 允许一次 · a 始终允许（保存全局规则）· n 拒绝"
	}
	notice := line(m.notice)
	help := "Enter 发送 · Alt+Enter 换行 · PgUp/PgDn 滚动 · Ctrl+R 思考 · Ctrl+C 停止/退出 · /help"
	view := tea.NewView(header + "\n" + m.viewport.View() + "\n" + accent.Render(line(status)) + "\n" + muted.Render(notice) + "\n" + m.input.View() + "\n" + muted.Render(line(help)))
	view.AltScreen = true
	if m.permission == nil {
		view.Cursor = m.input.Cursor()
		if view.Cursor != nil {
			view.Cursor.Y += 3 + m.viewport.Height() + 2
		}
	}
	return view
}
