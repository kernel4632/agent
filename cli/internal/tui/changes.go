/*
文件改动和回退确认：看这次会话改了哪些文件，回退前先说清会动到哪些消息和文件。
真正的回退请求也在这里发，确认页只负责把参数拼好。
*/
package tui

import (
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/kernel4632/agent/cli/internal/api"
	"github.com/kernel4632/agent/cli/internal/render"
)

func (m *model) openChanges() tea.Cmd {
	if m.client == nil {
		m.notice = "没有连接"
		return nil
	}
	m.overlay = overlayState{kind: "changes", loading: true}
	m.focus = focusOverlay
	m.input.Blur()
	m.renderConversation(true)
	client, ctx, id := m.client, m.ctx, m.session.ID
	return func() tea.Msg {
		var files []api.FileChange
		err := client.Request(ctx, "GET", api.SessionPath("changes", id), nil, &files)
		return changesMsg{files: files, err: err}
	}
}

func (m *model) confirmRollback(messageID, toolCallID string) tea.Cmd {
	if m.running {
		m.notice = "任务运行中，先停止再回退"
		m.renderConversation(false)
		return nil
	}
	if messageID == "" && toolCallID == "" {
		m.notice = "没有可回退的消息"
		m.renderConversation(false)
		return nil
	}
	kind := "rollback"
	if messageID == "" {
		kind = "toolrollback"
	}
	m.overlay = overlayState{
		kind: kind, loading: messageID != "", restoreFiles: true,
		messageID: messageID, toolCallID: toolCallID,
	}
	m.focus = focusOverlay
	m.input.Blur()
	m.renderConversation(true)
	if messageID == "" {
		return nil
	}
	client, ctx, id := m.client, m.ctx, m.session.ID
	return func() tea.Msg {
		var preview api.RollbackPreview
		err := client.Request(ctx, "POST", api.SessionPath("rollback/preview", id), map[string]string{"messageId": messageID}, &preview)
		return previewMsg{preview: preview, err: err}
	}
}

func (m *model) commitRollback() tea.Cmd {
	client, ctx, id := m.client, m.ctx, m.session.ID
	messageID, files := m.overlay.messageID, m.overlay.restoreFiles
	m.overlay.loading = true
	m.renderConversation(true)
	return func() tea.Msg {
		var session api.Session
		err := client.Request(ctx, "POST", api.SessionPath("rollback", id), map[string]any{"messageId": messageID, "files": files}, &session)
		if err != nil {
			return commandMsg{err: err}
		}
		return commandMsg{session: session, text: "已回退"}
	}
}

func (m *model) commitToolRollback() tea.Cmd {
	client, ctx, id := m.client, m.ctx, m.session.ID
	callID, files := m.overlay.toolCallID, m.overlay.restoreFiles
	m.overlay.loading = true
	return func() tea.Msg {
		var result struct {
			Restored []string `json:"restored"`
		}
		err := client.Request(ctx, "POST", api.SessionPath("rollback/tool", id), map[string]any{"toolCallId": callID, "files": files}, &result)
		if err != nil {
			return commandMsg{err: err}
		}
		session, err := client.Session(ctx, id)
		note := "已恢复这次工具改过的文件"
		if !files {
			note = "已丢掉这次工具的文件快照"
		}
		return commandMsg{session: session, err: err, text: note}
	}
}

func yesNo(value bool) string {
	if value {
		return "是"
	}
	return "否"
}

func (m *model) changesText() string {
	var b strings.Builder
	if len(m.overlay.changes) == 0 {
		b.WriteString(dim.Render("没有文件改动"))
		return strings.TrimRight(b.String(), "\n")
	}
	b.WriteString(accent.Render(itoa(len(m.overlay.changes))+" 个文件有改动") + "\n")
	for _, file := range m.overlay.changes {
		diff, added, removed := render.Unified(file.Before, file.After)
		state := ""
		if file.Added {
			state = gold.Render("新文件 ")
		} else if file.Deleted {
			state = warnText.Render("已删除 ")
		}
		counts := okText.Render("+"+itoa(added)) + " " + errText.Render("-"+itoa(removed))
		b.WriteString("\n" + state + file.Path + "  " + counts + "\n")
		if diff != "" {
			b.WriteString(render.Paint(render.Clip(diff, 80)))
			b.WriteByte('\n')
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

func (m *model) rollbackText() string {
	var b strings.Builder
	if m.overlay.kind == "toolrollback" {
		b.WriteString("只恢复这一次工具调用改过的文件，对话保留。\n")
		b.WriteString("恢复文件：" + yesNo(m.overlay.restoreFiles) + "（空格切换）\nEnter 确认 · Esc 取消\n")
		return strings.TrimRight(b.String(), "\n")
	}
	b.WriteString("回退这条消息以及它之后的对话？\n")
	if m.overlay.preview != nil {
		b.WriteString("将去掉 " + itoa(m.overlay.preview.Messages) + " 条消息")
		if n := len(m.overlay.preview.ToolCalls); n > 0 {
			b.WriteString("，" + itoa(n) + " 次工具调用")
		}
		b.WriteByte('\n')
		if n := len(m.overlay.preview.Files); n > 0 {
			b.WriteString("涉及 " + itoa(n) + " 个文件\n")
			limit := n
			if limit > 8 {
				limit = 8
			}
			for _, file := range m.overlay.preview.Files[:limit] {
				b.WriteString("  " + file.Path + "\n")
			}
		}
	}
	b.WriteString("\n恢复文件：" + yesNo(m.overlay.restoreFiles) + "（空格切换）\nEnter 确认 · Esc 取消\n")
	return strings.TrimRight(b.String(), "\n")
}
