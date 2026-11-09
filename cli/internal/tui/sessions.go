/*
会话列表和会话级动作：搜索、切换、新建，改模型/目录/思考强度，分支、回退撤销、重新生成标题。
列表行只显示标题和编号，编号留给 /open。
*/
package tui

import (
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/kernel4632/agent/cli/internal/api"
)

func (m *model) openSessions() tea.Cmd {
	if m.client == nil {
		m.notice = "没有连接"
		return nil
	}
	if m.running {
		m.notice = "任务运行中，先停止再切换会话"
		m.renderConversation(false)
		return nil
	}
	m.overlay = overlayState{kind: "sessions", loading: true}
	m.focus = focusOverlay
	m.input.Blur()
	m.renderConversation(true)
	client, ctx := m.client, m.ctx
	return func() tea.Msg {
		var list []api.Session
		err := client.Request(ctx, "GET", "/session/list", nil, &list)
		return sessionsMsg{list: list, err: err}
	}
}

func (m *model) visibleSessions() []api.Session {
	query := strings.ToLower(strings.TrimSpace(m.overlay.filter))
	if query == "" {
		return m.overlay.sessions
	}
	var matched []api.Session
	for _, session := range m.overlay.sessions {
		hay := strings.ToLower(session.Title + " " + session.ID + " " + session.Model)
		if strings.Contains(hay, query) {
			matched = append(matched, session)
		}
	}
	return matched
}

func (m *model) openSession(id string) tea.Cmd {
	m.overlay.loading = true
	m.renderConversation(true)
	client, ctx := m.client, m.ctx
	return func() tea.Msg {
		session, err := client.Session(ctx, id)
		return commandMsg{session: session, err: err}
	}
}

func (m *model) createSession(title string) tea.Cmd {
	m.overlay.loading = true
	m.renderConversation(true)
	client, ctx, current := m.client, m.ctx, m.session
	return func() tea.Msg {
		var created struct {
			ID string `json:"sessionId"`
		}
		err := client.Request(ctx, "POST", "/session/create", map[string]string{
			"title": title, "cwd": current.Cwd, "provider": current.Provider, "model": current.Model,
		}, &created)
		if err != nil {
			return commandMsg{err: err}
		}
		session, err := client.Session(ctx, created.ID)
		return commandMsg{session: session, err: err}
	}
}

func (m *model) patchSession(action string, body map[string]string) tea.Cmd {
	m.overlay.loading = true
	m.renderConversation(true)
	client, ctx, id := m.client, m.ctx, m.session.ID
	return func() tea.Msg {
		err := client.Request(ctx, "PATCH", api.SessionPath(action, id), body, nil)
		if err != nil {
			return commandMsg{err: err}
		}
		session, err := client.Session(ctx, id)
		return commandMsg{session: session, err: err}
	}
}

func (m *model) doFork(messageID string) tea.Cmd {
	if m.running {
		m.notice = "任务运行中，先停止再分支"
		m.renderConversation(false)
		return nil
	}
	if messageID == "" {
		m.notice = "没有可分支的消息"
		m.renderConversation(false)
		return nil
	}
	client, ctx, id := m.client, m.ctx, m.session.ID
	return func() tea.Msg {
		var created struct {
			ID string `json:"sessionId"`
		}
		err := client.Request(ctx, "POST", api.SessionPath("fork", id), map[string]string{"messageId": messageID}, &created)
		if err != nil {
			return commandMsg{err: err}
		}
		session, err := client.Session(ctx, created.ID)
		return commandMsg{session: session, err: err, text: "已分支"}
	}
}

func (m *model) doRedo() tea.Cmd {
	if m.session.Undoable == 0 {
		m.notice = "没有可撤销的回退"
		m.renderConversation(false)
		return nil
	}
	client, ctx, id := m.client, m.ctx, m.session.ID
	return func() tea.Msg {
		var session api.Session
		err := client.Request(ctx, "POST", api.SessionPath("redo", id), map[string]any{"files": true}, &session)
		if err != nil {
			return commandMsg{err: err}
		}
		return commandMsg{session: session, text: "已撤销回退"}
	}
}

func (m *model) doTitle() tea.Cmd {
	client, ctx, id := m.client, m.ctx, m.session.ID
	m.notice = "正在生成标题…"
	return func() tea.Msg {
		var result struct {
			Title string `json:"title"`
		}
		err := client.Request(ctx, "POST", api.SessionPath("title", id), nil, &result)
		if err != nil {
			return commandMsg{err: err}
		}
		session, err := client.Session(ctx, id)
		return commandMsg{session: session, err: err, text: result.Title}
	}
}

func (m *model) sessionsText() string {
	var b strings.Builder
	b.WriteString(accent.Render("会话"))
	if m.overlay.filter != "" {
		b.WriteString(dim.Render(" · 筛选 " + m.overlay.filter))
	}
	b.WriteString("\n" + dim.Render("Ctrl+N 新建 · Enter 打开 · Esc 关闭") + "\n\n")
	list := m.visibleSessions()
	if len(list) == 0 {
		b.WriteString(dim.Render("没有匹配的会话"))
		return strings.TrimRight(b.String(), "\n")
	}
	for i, session := range list {
		mark := "  "
		if i == m.overlay.index {
			mark = "▸ "
		}
		title := oneLine(strings.TrimSpace(session.Title), 48)
		if title == "" {
			title = "未命名"
		}
		row := mark + title
		if i == m.overlay.index {
			row = accent.Render(row)
		}
		b.WriteString(row + "  " + dim.Render(session.ID) + "\n") // 标题在前，编号留着给 /open
	}
	return strings.TrimRight(b.String(), "\n")
}

func (m *model) activateSessions() tea.Cmd {
	list := m.visibleSessions()
	if m.overlay.index < 0 || m.overlay.index >= len(list) {
		return nil
	}
	return m.openSession(list[m.overlay.index].ID)
}
