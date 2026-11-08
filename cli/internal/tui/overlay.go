/*
全屏层：会话、模型、目录、改动、任务、用量和命令说明。
打开时盖住对话，Esc 关掉。有选项的页用方向键移动，说明和用量只滚动。
*/
package tui

import (
	"net/url"
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/atotto/clipboard"
	"github.com/kernel4632/agent/cli/internal/api"
	"github.com/kernel4632/agent/cli/internal/render"
)

type overlayState struct {
	kind                  string
	filter                string
	index                 int
	loading               bool
	err                   string
	sessions              []api.Session
	models                []modelChoice
	changes               []api.FileChange
	preview               *api.RollbackPreview
	dir                   *api.Directory
	messageID, toolCallID string
	restoreFiles          bool
}

type modelChoice struct {
	provider, id, name string
	context            int
}

type sessionsMsg struct {
	list []api.Session
	err  error
}
type readyMsg struct {
	tools      []api.Tool
	config     api.Config
	failed     string
	configOnly bool
}
type changesMsg struct {
	files []api.FileChange
	err   error
}
type previewMsg struct {
	preview api.RollbackPreview
	err     error
}
type dirMsg struct {
	dir api.Directory
	err error
}
type copiedMsg struct{ err error }

func (m *model) closeOverlay() {
	m.overlay = overlayState{}
	if m.focus == focusOverlay {
		m.focus = focusInput
	}
}

func (m *model) readingOverlay() bool {
	return m.overlay.kind == "stats" || m.overlay.kind == "help" // 这两页没有可选项，方向键只滚动
}

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

func (m *model) openModels() tea.Cmd {
	m.overlay = overlayState{kind: "models", models: m.modelChoices()}
	m.focus = focusOverlay
	m.input.Blur()
	if len(m.overlay.models) > 0 {
		m.renderConversation(true)
		return nil
	}
	if m.client == nil {
		m.overlay.loading = false
		m.overlay.err = "没有连接"
		m.renderConversation(true)
		return nil
	}
	m.overlay.loading = true
	m.renderConversation(true)
	return m.fetchConfig(func(config api.Config) tea.Msg {
		return readyMsg{config: config, configOnly: true}
	})
}

func (m *model) openReasoning() tea.Cmd {
	m.overlay = overlayState{kind: "reasoning"}
	m.focus = focusOverlay
	m.input.Blur()
	for i, level := range reasoningLevels {
		if level == m.session.Settings.Reasoning {
			m.overlay.index = i
		}
	}
	m.renderConversation(true)
	return nil
}

func (m *model) openTodos() {
	m.overlay = overlayState{kind: "todos"}
	m.focus = focusOverlay
	m.input.Blur()
	m.renderConversation(true)
}

func (m *model) openHelp() {
	m.overlay = overlayState{kind: "help"} // 只盖住对话，不擦掉刚才那条命令结果
	m.focus = focusOverlay
	m.input.Blur()
	m.renderConversation(true)
}

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

func (m *model) openCwd() tea.Cmd {
	if m.running {
		m.notice = "任务运行中不能切换目录"
		m.renderConversation(false)
		return nil
	}
	m.overlay = overlayState{kind: "cwd", loading: true}
	m.focus = focusOverlay
	m.input.Blur()
	m.renderConversation(true)
	return m.loadDir(m.session.Cwd)
}

func (m *model) loadDir(path string) tea.Cmd {
	if m.client == nil {
		m.overlay.loading = false
		m.overlay.err = "没有连接"
		m.renderConversation(true)
		return nil
	}
	m.overlay.loading = true
	m.overlay.filter = ""
	m.overlay.index = 0
	client, ctx := m.client, m.ctx
	return func() tea.Msg {
		var dir api.Directory
		err := client.Request(ctx, "GET", "/filesystem/entries?mode=directory&path="+url.QueryEscape(path), nil, &dir)
		return dirMsg{dir: dir, err: err}
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

func (m *model) loadMeta() tea.Cmd {
	if m.client == nil {
		return nil
	}
	client, ctx := m.client, m.ctx
	return func() tea.Msg {
		var tools []api.Tool
		var config api.Config
		_ = client.Request(ctx, "GET", "/tool/list", nil, &tools)
		_ = client.Request(ctx, "GET", "/config/read", nil, &config)
		return readyMsg{tools: tools, config: config}
	}
}

func (m *model) fetchConfig(wrap func(api.Config) tea.Msg) tea.Cmd {
	if m.client == nil {
		return func() tea.Msg { return readyMsg{failed: "没有连接", configOnly: true} }
	}
	client, ctx := m.client, m.ctx
	return func() tea.Msg {
		var config api.Config
		err := client.Request(ctx, "GET", "/config/read", nil, &config)
		if err != nil {
			return readyMsg{failed: err.Error(), configOnly: true}
		}
		return wrap(config)
	}
}

func (m *model) modelChoices() []modelChoice {
	var choices []modelChoice
	for _, provider := range m.config.Providers {
		if provider.Enabled != nil && !*provider.Enabled {
			continue
		}
		for _, model := range provider.Models {
			name := model.Name
			if name == "" {
				name = model.ID
			}
			choices = append(choices, modelChoice{provider: provider.Name, id: model.ID, name: name, context: model.Context})
		}
	}
	return choices
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

func (m *model) visibleModels() []modelChoice {
	query := strings.ToLower(strings.TrimSpace(m.overlay.filter))
	if query == "" {
		return m.overlay.models
	}
	var matched []modelChoice
	for _, model := range m.overlay.models {
		hay := strings.ToLower(model.provider + " " + model.id + " " + model.name)
		if strings.Contains(hay, query) {
			matched = append(matched, model)
		}
	}
	return matched
}

func (m *model) visibleDirs() []struct{ name, path, kind string } {
	var items []struct{ name, path, kind string }
	if m.overlay.dir != nil {
		items = append(items, struct{ name, path, kind string }{"使用此目录", m.overlay.dir.Current, "use"})
		query := strings.ToLower(m.overlay.filter)
		for _, entry := range m.overlay.dir.Entries {
			if query != "" && !strings.Contains(strings.ToLower(entry.Name), query) {
				continue
			}
			items = append(items, struct{ name, path, kind string }{entry.Name, entry.Path, entry.Type})
		}
	}
	return items
}

func (m *model) overlayText() string {
	if m.overlay.loading {
		return "正在读取…"
	}
	if m.overlay.err != "" {
		return m.overlay.err
	}
	var b strings.Builder
	switch m.overlay.kind {
	case "sessions":
		b.WriteString("会话")
		if m.overlay.filter != "" {
			b.WriteString(" · 筛选 " + m.overlay.filter)
		}
		b.WriteString("\nCtrl+N 新建 · Enter 打开 · Esc 关闭\n\n")
		list := m.visibleSessions()
		if len(list) == 0 {
			b.WriteString("没有匹配的会话")
			break
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
			b.WriteString(mark + title + "  " + muted.Render(session.ID) + "\n") // 标题在前，编号留着给 /open
		}
	case "models":
		b.WriteString("模型")
		if m.overlay.filter != "" {
			b.WriteString(" · 筛选 " + m.overlay.filter)
		}
		b.WriteString("\n\n")
		list := m.visibleModels()
		if len(list) == 0 {
			b.WriteString("没有已配置的模型")
			break
		}
		for i, model := range list {
			mark := "  "
			if i == m.overlay.index {
				mark = "▸ "
			}
			current := ""
			if model.provider == m.session.Provider && model.id == m.session.Model {
				current = "  ←"
			}
			b.WriteString(mark + model.provider + "/" + model.id)
			if model.name != model.id {
				b.WriteString("  " + model.name)
			}
			b.WriteString(current + "\n")
		}
	case "reasoning":
		b.WriteString("思考强度\n\n")
		for i, level := range reasoningLevels {
			mark := "  "
			if i == m.overlay.index {
				mark = "▸ "
			}
			b.WriteString(mark + level + "\n")
		}
	case "todos":
		b.WriteString("任务清单\n\n")
		if len(m.todos) == 0 {
			b.WriteString("还没有任务。模型更新清单后会显示在这里。")
			break
		}
		done := 0
		for _, item := range m.todos {
			if item.Status == "completed" {
				done++
			}
		}
		b.WriteString("进度 " + itoa(done) + "/" + itoa(len(m.todos)) + "\n\n")
		for _, item := range m.todos {
			mark := "·"
			switch item.Status {
			case "completed":
				mark = "✓"
			case "in_progress":
				mark = "▸"
			}
			b.WriteString(mark + " " + item.Text + "\n")
		}
	case "changes":
		if len(m.overlay.changes) == 0 {
			b.WriteString("没有文件改动")
			break
		}
		b.WriteString(itoa(len(m.overlay.changes)) + " 个文件有改动\n")
		for _, file := range m.overlay.changes {
			diff, added, removed := render.Unified(file.Before, file.After)
			state := ""
			if file.Added {
				state = "新文件 "
			} else if file.Deleted {
				state = "已删除 "
			}
			b.WriteString("\n" + state + file.Path + "  +" + itoa(added) + " -" + itoa(removed) + "\n")
			if diff != "" {
				b.WriteString(render.Paint(render.Clip(diff, 80)))
				b.WriteByte('\n')
			}
		}
	case "cwd":
		current := ""
		if m.overlay.dir != nil {
			current = m.overlay.dir.Current
		}
		b.WriteString("目录 · " + current + "\nEnter 进入或使用 · Backspace 上级 · Esc 关闭\n\n")
		for i, item := range m.visibleDirs() {
			mark := "  "
			if i == m.overlay.index {
				mark = "▸ "
			}
			suffix := ""
			if item.kind == "directory" {
				suffix = "/"
			}
			b.WriteString(mark + item.name + suffix + "\n")
		}
	case "rollback":
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
	case "toolrollback":
		b.WriteString("只恢复这一次工具调用改过的文件，对话保留。\n")
		b.WriteString("恢复文件：" + yesNo(m.overlay.restoreFiles) + "（空格切换）\nEnter 确认 · Esc 取消\n")
	case "stats":
		b.WriteString(m.statsText())
	case "help":
		b.WriteString(m.helpText())
	}
	return strings.TrimRight(b.String(), "\n")
}

func (m *model) overlayKey(key string) tea.Cmd {
	switch key {
	case "esc":
		m.closeOverlay()
		m.renderConversation(false)
		return m.input.Focus()
	case "up":
		if m.readingOverlay() {
			m.viewport.ScrollUp(1)
			return nil
		}
		if m.overlay.index > 0 {
			m.overlay.index--
		}
		m.renderConversation(false)
		return nil
	case "down":
		if m.readingOverlay() {
			m.viewport.ScrollDown(1)
			return nil
		}
		m.overlay.index++
		m.clampOverlay()
		m.renderConversation(false)
		return nil
	case "enter":
		return m.activateOverlay()
	case " ":
		if m.overlay.kind == "rollback" || m.overlay.kind == "toolrollback" {
			m.overlay.restoreFiles = !m.overlay.restoreFiles
			m.renderConversation(false)
			return nil
		}
	case "backspace":
		if m.overlay.filter != "" && m.overlay.kind != "rollback" && m.overlay.kind != "toolrollback" && m.overlay.kind != "reasoning" && m.overlay.kind != "todos" && m.overlay.kind != "changes" {
			runes := []rune(m.overlay.filter)
			m.overlay.filter = string(runes[:len(runes)-1])
			m.overlay.index = 0
			m.renderConversation(true)
			return nil
		}
		if m.overlay.kind == "cwd" && m.overlay.dir != nil && m.overlay.dir.Parent != nil {
			return m.loadDir(*m.overlay.dir.Parent)
		}
		return nil
	case "ctrl+n":
		if m.overlay.kind == "sessions" {
			return m.createSession("新对话")
		}
		return nil
	}
	if m.overlay.kind == "sessions" || m.overlay.kind == "models" || m.overlay.kind == "cwd" {
		if len([]rune(key)) == 1 {
			m.overlay.filter += key
			m.overlay.index = 0
			m.renderConversation(true)
		}
	}
	return nil
}

func (m *model) clampOverlay() {
	n := 0
	switch m.overlay.kind {
	case "sessions":
		n = len(m.visibleSessions())
	case "models":
		n = len(m.visibleModels())
	case "reasoning":
		n = len(reasoningLevels)
	case "cwd":
		n = len(m.visibleDirs())
	case "todos":
		n = len(m.todos)
	}
	if n == 0 {
		m.overlay.index = 0
		return
	}
	if m.overlay.index >= n {
		m.overlay.index = n - 1
	}
	if m.overlay.index < 0 {
		m.overlay.index = 0
	}
}

func (m *model) activateOverlay() tea.Cmd {
	switch m.overlay.kind {
	case "sessions":
		list := m.visibleSessions()
		if m.overlay.index < 0 || m.overlay.index >= len(list) {
			return nil
		}
		return m.openSession(list[m.overlay.index].ID)
	case "models":
		list := m.visibleModels()
		if m.overlay.index < 0 || m.overlay.index >= len(list) {
			return nil
		}
		choice := list[m.overlay.index]
		return m.patchSession("model", map[string]string{"provider": choice.provider, "model": choice.id})
	case "reasoning":
		if m.overlay.index < 0 || m.overlay.index >= len(reasoningLevels) {
			return nil
		}
		return m.patchSession("settings", map[string]string{"reasoning": reasoningLevels[m.overlay.index]})
	case "cwd":
		items := m.visibleDirs()
		if m.overlay.index < 0 || m.overlay.index >= len(items) {
			return nil
		}
		item := items[m.overlay.index]
		if item.kind == "use" {
			return m.patchSession("cwd", map[string]string{"cwd": item.path})
		}
		return m.loadDir(item.path)
	case "rollback":
		return m.commitRollback()
	case "toolrollback":
		return m.commitToolRollback()
	default:
		return nil
	}
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

func (m *model) copyText() string {
	if m.focus == focusTranscript && m.selected >= 0 && m.selected < len(m.blocks) {
		return blockCopy(m.blocks[m.selected])
	}
	for i := len(m.blocks) - 1; i >= 0; i-- {
		switch m.blocks[i].kind {
		case "answer", "text", "user", "question", "tool":
			if text := blockCopy(m.blocks[i]); text != "" {
				return text
			}
		}
	}
	return ""
}

func blockCopy(item block) string {
	if text := strings.TrimSpace(item.copy); text != "" {
		return text
	}
	if text := strings.TrimSpace(item.body); text != "" {
		return text
	}
	return strings.TrimSpace(item.plain)
}

func (m *model) copyTarget() tea.Cmd {
	text := m.copyText()
	if text == "" {
		m.notice = "没有可复制的内容"
		m.renderConversation(false)
		return nil
	}
	return func() tea.Msg {
		return copiedMsg{err: clipboard.WriteAll(text)}
	}
}

func (m *model) targetIDs() (messageID, toolCallID string) {
	if m.focus == focusTranscript && m.selected >= 0 && m.selected < len(m.blocks) {
		item := m.blocks[m.selected]
		return item.messageID, item.toolCallID
	}
	for i := len(m.blocks) - 1; i >= 0; i-- {
		if m.blocks[i].messageID != "" {
			return m.blocks[i].messageID, ""
		}
	}
	return "", ""
}

func (m *model) handleKey(msg tea.KeyPressMsg) (tea.Cmd, bool) {
	key := msg.String()
	if key == "ctrl+c" || key == "ctrl+q" {
		if m.running {
			m.quitting = key == "ctrl+q"
			m.status = "正在停止并保存…"
			if m.cancel != nil {
				m.cancel()
			}
			return nil, true
		}
		return tea.Quit, true
	}
	if m.overlay.kind != "" {
		if key == "pgup" || key == "pgdown" {
			if key == "pgup" {
				m.viewport.PageUp()
			} else {
				m.viewport.PageDown()
			}
			return nil, true
		}
		return m.overlayKey(key), true
	}
	if key == "pgup" || key == "pgdown" {
		if key == "pgup" {
			m.viewport.PageUp()
		} else {
			m.viewport.PageDown()
		}
		return nil, true
	}
	if cmd, ok := m.choiceKey(key); ok {
		return cmd, true
	}
	if m.focus == focusInput && m.slashMenu() == "" && m.input.LineCount() <= 1 && (key == "up" || key == "down") {
		if key == "up" {
			m.viewport.ScrollUp(1)
		} else {
			m.viewport.ScrollDown(1)
		}
		return nil, true
	}
	if key == "ctrl+r" {
		m.showReasoning = !m.showReasoning
		m.renderConversation(false)
		return nil, true
	}
	if key == "esc" && m.running {
		m.status = "正在停止并保存…"
		if m.cancel != nil {
			m.cancel()
		}
		return nil, true
	}
	if key == "esc" && m.focus == focusTranscript {
		m.focus = focusInput
		m.renderConversation(false)
		return m.input.Focus(), true
	}
	if m.permission != nil {
		decision := map[string]string{"y": "allow-once", "a": "allow-always", "n": "deny"}[key]
		if decision != "" {
			m.permission.reply <- decision
			m.permission = nil
			m.status = "正在运行…"
			m.renderConversation(false)
		}
		return nil, true
	}
	if m.focus == focusInput {
		if cmd, ok := m.suggestKey(key); ok {
			return cmd, true
		}
	}
	if cmd, ok := m.globalKey(key); ok {
		return cmd, true
	}
	if m.focus == focusTranscript {
		return m.transcriptKey(key)
	}
	if key == "enter" {
		if m.running || m.busy {
			return nil, true
		}
		text := strings.TrimSpace(m.input.Value())
		if text == "" {
			return nil, true
		}
		m.input.Reset()
		if strings.HasPrefix(text, "/") {
			return m.slash(text), true
		}
		return m.begin("send", text), true
	}
	return nil, false
}

func (m *model) globalKey(key string) (tea.Cmd, bool) {
	switch key {
	case "ctrl+p":
		return m.openSessions(), true
	case "ctrl+m":
		return m.openModels(), true
	case "ctrl+g":
		return m.openChanges(), true
	case "ctrl+w":
		return m.openCwd(), true
	case "ctrl+t":
		m.openTodos()
		return nil, true
	case "ctrl+u":
		m.openStats()
		return nil, true
	case "ctrl+y":
		m.rebuild()
		return m.copyTarget(), true
	case "tab":
		if m.focus == focusInput {
			m.focus = focusTranscript
			m.input.Blur()
			m.rebuild()
		} else {
			m.focus = focusInput
		}
		m.renderConversation(false)
		if m.focus == focusInput {
			return m.input.Focus(), true
		}
		return nil, true
	default:
		return nil, false
	}
}

func (m *model) transcriptKey(key string) (tea.Cmd, bool) {
	switch key {
	case "j", "down":
		m.stepSelection(1)
	case "k", "up":
		m.stepSelection(-1)
	case "enter":
		if m.selected >= 0 && m.selected < len(m.blocks) {
			item := m.blocks[m.selected]
			if _, collapse := m.toolRun(m.selected); collapse {
				m.toolList[item.id] = !m.toolList[item.id]
			} else {
				m.open[item.id] = !m.blockOpen(item)
			}
		}
	case "c":
		m.renderConversation(false)
		return m.copyTarget(), true
	case "x":
		messageID, _ := m.targetIDs()
		return m.confirmRollback(messageID, ""), true
	case "f":
		messageID, _ := m.targetIDs()
		return m.doFork(messageID), true
	case "r":
		if m.selected < 0 || m.selected >= len(m.blocks) || m.blocks[m.selected].kind != "tool" || m.blocks[m.selected].toolCallID == "" {
			m.notice = "当前不是一次工具调用"
			break
		}
		return m.confirmRollback("", m.blocks[m.selected].toolCallID), true
	case "u":
		return m.doRedo(), true
	default:
		return nil, true
	}
	m.renderConversation(false)
	return nil, true
}

func (m *model) stepSelection(delta int) {
	next := m.selected
	for {
		next += delta
		if next < 0 || next >= len(m.blocks) {
			return
		}
		if !m.toolHidden(next) {
			m.selected = next
			m.selectedID = m.blocks[next].id
			return
		}
	}
}

func yesNo(value bool) string {
	if value {
		return "是"
	}
	return "否"
}

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

var reasoningLevels = []string{"off", "auto", "low", "medium", "high", "xhigh", "max"}
