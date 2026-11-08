// Package tui provides the Bubble Tea chat client. All visible state is owned
// by Update; network workers only send messages and never edit the model.
package tui

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/textarea"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/term"
	"github.com/kernel4632/agent/cli/internal/api"
	"github.com/kernel4632/agent/cli/internal/chat"
)

const (
	focusInput = iota
	focusTranscript
	focusOverlay
)

type permissionMsg struct {
	permission api.Permission
	reply      chan string
}
type snapshotMsg api.Session
type doneMsg struct {
	session api.Session
	err     error
}
type commandMsg struct {
	session api.Session
	text    string
	err     error
}
type clockMsg struct{}

type model struct {
	ctx                                                                               context.Context
	client                                                                            *api.Client
	session                                                                           api.Session
	input                                                                             textarea.Model
	viewport                                                                          viewport.Model
	updates                                                                           chan tea.Msg
	cancel                                                                            context.CancelFunc
	runDone                                                                           chan struct{}
	running, busy, quitting                                                           bool
	permission                                                                        *permissionMsg
	width, height                                                                     int
	status, notice, panel, liveText, liveReasoning, liveLog, lastControl, finalAnswer string
	showReasoning                                                                     bool
	focus                                                                             int
	overlay                                                                           overlayState
	tools                                                                             map[string]api.Tool
	config                                                                            api.Config
	steps                                                                             []liveStep
	lastUsage                                                                         usageSnap
	todos                                                                             []api.Todo
	open, toolList                                                                    map[string]bool
	blocks                                                                            []block
	selected                                                                          int
	selectedID                                                                        string
	choiceAt                                                                          int
	choiceFor                                                                         string
	choiceWrite                                                                       bool
	llmStarted, firstTokenAt                                                          int64
	turnAt                                                                            time.Time
	spans                                                                             []blockSpan
	frameTop, frameVP, statsWidth                                                     int
	suggestAt                                                                         int
	suggestQuery, suggestMute                                                         string
}

func CheckTerminal() error {
	if !term.IsTerminal(os.Stdin.Fd()) || !term.IsTerminal(os.Stdout.Fd()) {
		return fmt.Errorf("chat 需要交互终端；管道和重定向请使用 agent ask")
	}
	return nil
}

func Run(ctx context.Context, client *api.Client, session api.Session) error {
	ctx, cancel := context.WithCancel(ctx)
	m := newModel(ctx, client, session)
	_, err := tea.NewProgram(m, tea.WithContext(ctx)).Run()
	cancel()
	// Closing the terminal must also cancel and stop its outstanding run.
	if m.cancel != nil {
		m.cancel()
	}
	if m.runDone != nil {
		select {
		case <-m.runDone:
		case <-time.After(10 * time.Second):
		}
	}
	return err
}

func newModel(ctx context.Context, client *api.Client, session api.Session) *model {
	input := textarea.New()
	styles := textarea.DefaultDarkStyles()
	styles.Focused.CursorLine = lipgloss.NewStyle()
	styles.Blurred.CursorLine = lipgloss.NewStyle()
	styles.Focused.Placeholder = lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	styles.Blurred.Placeholder = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
	styles.Focused.Prompt = lipgloss.NewStyle().Foreground(lipgloss.Color("75"))
	styles.Blurred.Prompt = lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	styles.Cursor.Shape = tea.CursorBar
	input.SetStyles(styles)
	// 输入法预编辑跟着终端光标。假光标不会上报位置，真实光标就留在最后一行，中文会先出现在底栏。
	input.SetVirtualCursor(false)
	input.Placeholder = "输入消息，/ 查看命令"
	input.ShowLineNumbers = false
	input.EndOfBufferCharacter = ' '
	input.Prompt = "> "
	input.SetPromptFunc(2, func(info textarea.PromptInfo) string {
		if info.LineNumber == 0 {
			return "> "
		}
		return "  "
	})
	input.CharLimit = 100000
	input.DynamicHeight = true
	input.MinHeight = 1
	input.MaxHeight = 6
	input.SetHeight(1)
	input.SetWidth(78)
	input.KeyMap.InsertNewline = key.NewBinding(key.WithKeys("alt+enter", "shift+enter", "ctrl+j"))
	view := viewport.New(viewport.WithWidth(78), viewport.WithHeight(15))
	view.SoftWrap = true
	view.FillHeight = true
	m := &model{ctx: ctx, client: client, session: session, input: input, viewport: view,
		updates: make(chan tea.Msg, 128), width: 80, height: 25, status: "就绪",
		tools: map[string]api.Tool{}, open: map[string]bool{}, toolList: map[string]bool{}}
	m.todos = parseTodos(session.Todos)
	m.lastUsage = usageFromHistory(session.History)
	m.renderConversation(true)
	return m
}

func (m *model) Init() tea.Cmd {
	cmds := []tea.Cmd{m.input.Focus(), m.wait(), m.loadMeta()}
	if m.session.Running || len(m.session.Pending) > 0 {
		cmds = append(cmds, m.begin("watch", ""))
	}
	return tea.Batch(cmds...)
}

func (m *model) wait() tea.Cmd {
	return func() tea.Msg {
		select {
		case msg := <-m.updates:
			return msg
		case <-m.ctx.Done():
			return nil
		}
	}
}

func (m *model) begin(action, input string) tea.Cmd {
	m.running = true
	m.turnAt = time.Now() // 这一轮的起点；界面每秒读它，不靠重绘整段对话
	m.status, m.notice = "正在运行…", ""
	m.panel = ""
	m.liveText, m.liveReasoning, m.liveLog, m.lastControl, m.finalAnswer = "", "", "", "", ""
	m.steps = nil
	initial := m.session
	if action == "send" {
		content, _ := json.Marshal(input)
		m.session.History = append(m.session.History, api.Message{Role: "user", Content: content})
	}
	m.renderConversation(true)
	ctx, cancel := context.WithCancel(m.ctx)
	m.cancel = cancel
	done := make(chan struct{})
	m.runDone = done
	updates, client := m.updates, m.client
	return func() tea.Msg {
		defer close(done)
		defer cancel()
		emit := func(msg tea.Msg) {
			select {
			case updates <- msg:
			case <-ctx.Done():
			}
		}
		go func() {
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					emit(clockMsg{}) // 只推动底栏时钟；不重建对话，避免思考区跟着跳
				}
			}
		}()
		err := chat.Run(ctx, client, initial, action, input, chat.Hooks{
			Event:    func(e api.Event) { emit(e) },
			Snapshot: func(s api.Session) { emit(snapshotMsg(s)) },
			Permission: func(ctx context.Context, p api.Permission) error {
				reply := make(chan string, 1)
				emit(permissionMsg{permission: p, reply: reply})
				select {
				case decision := <-reply:
					return client.Decide(ctx, initial.ID, p.CallID, decision)
				case <-ctx.Done():
					return ctx.Err()
				}
			},
		})
		readCtx, finish := context.WithTimeout(context.Background(), 5*time.Second)
		defer finish()
		saved, readErr := client.Session(readCtx, initial.ID)
		if err == nil {
			err = readErr
		}
		// Queue completion after all stream updates, retaining event order.
		select {
		case updates <- doneMsg{session: saved, err: err}:
		case <-m.ctx.Done():
		}
		return nil
	}
}

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.input.SetWidth(max(10, msg.Width-2))
		limit := max(3, min(10, msg.Height/4))
		m.input.MaxHeight = limit
		if m.input.Height() > limit {
			m.input.SetHeight(limit)
		}
		m.renderConversation(false)
	case tea.MouseWheelMsg:
		switch msg.Button {
		case tea.MouseWheelUp:
			m.viewport.ScrollUp(3)
		case tea.MouseWheelDown:
			m.viewport.ScrollDown(3)
		}
		return m, nil
	case tea.MouseClickMsg:
		if cmd, handled := m.click(msg); handled {
			return m, cmd
		}
	case api.Event:
		m.event(msg)
		m.renderConversation(false)
		return m, m.wait()
	case snapshotMsg:
		m.adopt(api.Session(msg))
		m.liveText, m.liveReasoning, m.liveLog, m.lastControl, m.finalAnswer = "", "", "", "", ""
		m.steps = nil
		m.renderConversation(false)
		return m, m.wait()
	case permissionMsg:
		m.permission = &msg
		m.status = "等待工具审批"
		m.renderConversation(true)
		return m, m.wait()
	case doneMsg:
		m.running, m.permission, m.cancel = false, nil, nil
		m.status = "就绪"
		if msg.session.ID != "" {
			m.adopt(msg.session)
			m.liveText, m.liveReasoning, m.liveLog, m.finalAnswer = "", "", "", ""
			m.steps = nil
		}
		if msg.err != nil {
			m.notice = msg.err.Error()
			if errors.Is(msg.err, context.Canceled) {
				m.notice = "已停止，生成进度已保存"
			}
		}
		m.renderConversation(false)
		if m.quitting {
			return m, tea.Quit
		}
		return m, m.wait()
	case commandMsg:
		m.busy = false
		m.closeOverlay()
		if msg.err != nil {
			m.notice = msg.err.Error()
		} else {
			m.notice = ""
			if msg.session.ID == "" {
				m.panel = msg.text
			} else {
				m.panel = ""
				if msg.text != "" {
					m.notice = msg.text
				}
				m.adopt(msg.session)
				m.liveText, m.liveReasoning, m.liveLog, m.finalAnswer = "", "", "", ""
				m.steps = nil
				m.renderConversation(true)
				if msg.session.Running || len(msg.session.Pending) > 0 {
					return m, tea.Batch(m.begin("watch", ""), m.input.Focus())
				}
				return m, m.input.Focus()
			}
		}
		m.renderConversation(true)
		return m, m.input.Focus()
	case readyMsg:
		if msg.failed != "" {
			if m.overlay.kind != "" {
				m.overlay.loading = false
				m.overlay.err = msg.failed
			} else {
				m.notice = msg.failed
			}
		} else if msg.configOnly {
			m.config = msg.config
			m.overlay.models = m.modelChoices()
			m.overlay.loading = false
		} else {
			m.tools = map[string]api.Tool{}
			for _, tool := range msg.tools {
				m.tools[tool.Name] = tool
			}
			m.config = msg.config
		}
		m.renderConversation(false)
		return m, nil
	case sessionsMsg:
		m.overlay.loading = false
		m.overlay.sessions = msg.list
		m.overlay.err = errString(msg.err)
		m.clampOverlay()
		m.renderConversation(true)
		return m, nil
	case changesMsg:
		m.overlay.loading = false
		m.overlay.changes = msg.files
		m.overlay.err = errString(msg.err)
		m.renderConversation(true)
		return m, nil
	case previewMsg:
		m.overlay.loading = false
		if msg.err != nil {
			m.overlay.err = msg.err.Error()
		} else {
			m.overlay.preview = &msg.preview
		}
		m.renderConversation(true)
		return m, nil
	case dirMsg:
		m.overlay.loading = false
		if msg.err != nil {
			m.overlay.err = msg.err.Error()
		} else {
			m.overlay.dir = &msg.dir
			m.overlay.err = ""
			m.overlay.index = 0
		}
		m.renderConversation(true)
		return m, nil
	case copiedMsg:
		if msg.err != nil {
			m.notice = "无法写入剪贴板：" + msg.err.Error()
		} else {
			m.notice = "已复制"
		}
		m.renderConversation(false)
		return m, nil
	case clockMsg:
		return m, m.wait() // 这条消息占用了等待，必须重新排上，否则后续事件没人收
	case tea.KeyPressMsg:
		if cmd, handled := m.handleKey(msg); handled {
			return m, cmd
		}
	}
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	return m, cmd
}

func (m *model) adopt(session api.Session) {
	if session.ID == "" {
		return
	}
	m.session = session
	if items := parseTodos(session.Todos); len(items) > 0 || len(session.Todos) > 0 {
		m.todos = items
	}
	if usage := usageFromHistory(session.History); usage.Input+usage.Output > 0 {
		m.lastUsage = usage
	}
}

func (m *model) liveTool(id, name string) *liveTool {
	for i := len(m.steps) - 1; i >= 0; i-- {
		tool := m.steps[i].tool
		if tool == nil {
			continue
		}
		if id != "" && tool.id == id {
			return tool
		}
		if id == "" && name != "" && tool.name == name && tool.running {
			return tool
		}
	}
	return nil
}

func (m *model) event(e api.Event) {
	if e.IsCompact() {
		return
	}
	switch e.Type {
	case "text-delta":
		m.liveText += e.Text
	case "reasoning-delta":
		m.liveReasoning += e.Text
	case "llm-start":
		if m.liveText != "" {
			m.steps = append(m.steps, liveStep{kind: "text", text: m.liveText})
			m.liveText = ""
		}
		if m.liveReasoning != "" {
			m.steps = append(m.steps, liveStep{kind: "reasoning", text: m.liveReasoning})
			m.liveReasoning = ""
		}
		m.status = "正在请求模型…"
		m.llmStarted = e.StartedAt
		if m.llmStarted == 0 {
			m.llmStarted = time.Now().UnixMilli()
		}
		m.firstTokenAt = 0
	case "llm-first-token":
		m.firstTokenAt = e.FirstTokenAt
		if m.firstTokenAt == 0 && e.FirstTokenMs > 0 && m.llmStarted > 0 {
			m.firstTokenAt = m.llmStarted + e.FirstTokenMs
		}
		if m.firstTokenAt == 0 {
			m.firstTokenAt = time.Now().UnixMilli()
		}
	case "llm-finish":
		if e.Text != "" {
			m.liveText = e.Text
		}
		if usage := parseUsage(e.Usage); usage.Input+usage.Output > 0 {
			m.lastUsage = usage
		}
	case "tool-call":
		if m.liveText != "" {
			m.steps = append(m.steps, liveStep{kind: "text", text: m.liveText})
			m.liveText = ""
		}
		if answer := chat.ControlAnswer(e.ToolName, e.Input); answer != "" {
			m.finalAnswer = answer
			m.lastControl = e.ToolCallID
			break
		}
		tool := &liveTool{id: e.ToolCallID, name: e.ToolName, input: e.Input, running: true, started: time.Now()}
		if e.StartedAt > 0 {
			tool.started = time.UnixMilli(e.StartedAt)
		}
		m.steps = append(m.steps, liveStep{kind: "tool", tool: tool})
	case "tool-result":
		if tool := m.liveTool(e.ToolCallID, e.ToolName); tool != nil {
			tool.running = false
			tool.result = e.Output
			if e.DurationMs > 0 {
				tool.duration = time.Duration(e.DurationMs) * time.Millisecond
			} else if !tool.started.IsZero() {
				tool.duration = time.Since(tool.started)
			}
		}
		if e.ToolName == "update_todo_list" {
			if items := todosFromOutput(e.Output); len(items) > 0 {
				m.todos = items
			}
		}
	case "tool-output":
		if tool := m.liveTool(e.ToolCallID, e.ToolName); tool != nil {
			tool.stream.WriteString(chat.Output(e.Data))
		}
	case "permission-blocked", "permission-limit":
		if e.Reason != "" {
			m.notice = e.Reason
		}
	case "title":
		m.session.Title = e.Title
	case "reconnecting":
		m.status = "连接中断，正在重新读取历史…"
	case "retry":
		m.status = "模型请求重试中…"
	case "compact-start":
		m.status = "正在压缩上下文…"
	case "compact-finish":
		m.status = "上下文已压缩"
	case "error", "mcp-error":
		m.notice = e.Failure()
	}
}
