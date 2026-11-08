/*
全屏层的骨架：共享状态、开关、按键分发、选中项收口。
每一页的版式和动作在各自的文件里：sessions.go、models.go、cwd.go、
changes.go、todos.go、help.go；用量和命令说明复用了 stats.go 和 help.go。
*/
package tui

import (
	tea "charm.land/bubbletea/v2"
	"github.com/kernel4632/agent/cli/internal/api"
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

// overlayText 把当前页面交给对应的绘制函数。这里只做分发，版式各在各的文件里。
func (m *model) overlayText() string {
	if m.overlay.loading {
		return "正在读取…"
	}
	if m.overlay.err != "" {
		return m.overlay.err
	}
	switch m.overlay.kind {
	case "sessions":
		return m.sessionsText()
	case "models":
		return m.modelsText()
	case "reasoning":
		return m.reasoningText()
	case "todos":
		return m.todosText()
	case "changes":
		return m.changesText()
	case "cwd":
		return m.cwdText()
	case "rollback", "toolrollback":
		return m.rollbackText()
	case "stats":
		return m.statsText()
	case "help":
		return m.helpText()
	}
	return ""
}

func (m *model) overlayKey(key string) tea.Cmd {
	switch key {
	case "esc":
		m.closeOverlay()
		m.renderConversation(true) // 浮层的滚动位置不能留在对话上，否则回来像卡住
		m.wakeStream()
		cmd := m.input.Focus()
		if !m.running {
			cmd = tea.Batch(cmd, m.catchUp())
		}
		return cmd
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
		if m.overlay.filter != "" && m.overlayFilterable() {
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
	if m.overlayFilterable() && len([]rune(key)) == 1 {
		m.overlay.filter += key // 单键就是往筛选词里加字，列表和目录都靠它缩小范围
		m.overlay.index = 0
		m.renderConversation(true)
	}
	return nil
}

// overlayFilterable 表示这一页能打字筛选。回退确认、思考和任务清单没有可筛的东西。
func (m *model) overlayFilterable() bool {
	switch m.overlay.kind {
	case "sessions", "models", "cwd":
		return true
	}
	return false
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

// activateOverlay 执行当前页的确认动作，回车走这里。
func (m *model) activateOverlay() tea.Cmd {
	switch m.overlay.kind {
	case "sessions":
		return m.activateSessions()
	case "models":
		return m.activateModel()
	case "reasoning":
		return m.activateReasoning()
	case "cwd":
		return m.activateCwd()
	case "rollback":
		return m.commitRollback()
	case "toolrollback":
		return m.commitToolRollback()
	}
	return nil
}
