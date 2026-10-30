// Package tui provides the Bubble Tea chat client. All visible state is owned
// by Update; network workers only send messages and never edit the model.
package tui

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/textarea"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/term"
	"github.com/kernel4632/agent/cli/internal/api"
	"github.com/kernel4632/agent/cli/internal/chat"
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

type model struct {
	ctx                                                                  context.Context
	client                                                               *api.Client
	session                                                              api.Session
	input                                                                textarea.Model
	viewport                                                             viewport.Model
	updates                                                              chan tea.Msg
	cancel                                                               context.CancelFunc
	runDone                                                              chan struct{}
	running, busy, quitting                                              bool
	permission                                                           *permissionMsg
	width, height                                                        int
	status, notice, panel, liveText, liveReasoning, liveLog, lastControl string
	showReasoning                                                        bool
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
	input.Placeholder = "输入消息，或 /help 查看命令"
	input.ShowLineNumbers = false
	input.Prompt = "› "
	input.CharLimit = 100000
	input.SetHeight(3)
	input.SetWidth(78)
	input.KeyMap.InsertNewline = key.NewBinding(key.WithKeys("alt+enter", "shift+enter", "ctrl+j"))
	view := viewport.New(viewport.WithWidth(78), viewport.WithHeight(15))
	view.SoftWrap = true
	view.FillHeight = true
	m := &model{ctx: ctx, client: client, session: session, input: input, viewport: view,
		updates: make(chan tea.Msg, 128), width: 80, height: 25, status: "就绪"}
	m.renderConversation(true)
	return m
}

func (m *model) Init() tea.Cmd {
	cmds := []tea.Cmd{m.input.Focus(), m.wait()}
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
	m.status, m.notice = "正在运行…", ""
	m.panel = ""
	m.liveText, m.liveReasoning, m.liveLog, m.lastControl = "", "", "", ""
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
		m.viewport.SetWidth(max(10, msg.Width-2))
		m.viewport.SetHeight(max(2, msg.Height-10))
		m.renderConversation(false)
	case api.Event:
		m.event(msg)
		m.renderConversation(false)
		return m, m.wait()
	case snapshotMsg:
		m.session = api.Session(msg)
		m.liveText, m.liveReasoning, m.liveLog, m.lastControl = "", "", "", ""
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
			m.session = msg.session
			m.liveText, m.liveReasoning, m.liveLog = "", "", ""
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
		if msg.err != nil {
			m.notice = msg.err.Error()
		} else {
			m.notice = ""
			m.panel = msg.text
			if msg.session.ID != "" {
				m.session = msg.session
				m.liveText, m.liveReasoning, m.liveLog = "", "", ""
				if msg.session.Running || len(msg.session.Pending) > 0 {
					return m, m.begin("watch", "")
				}
			}
		}
		m.renderConversation(true)
		return m, nil
	case tea.KeyPressMsg:
		key := msg.String()
		if key == "ctrl+c" || key == "ctrl+q" {
			if m.running {
				m.quitting = key == "ctrl+q"
				m.status = "正在停止并保存…"
				if m.cancel != nil {
					m.cancel()
				}
				return m, nil
			}
			return m, tea.Quit
		}
		if key == "pgup" || key == "pgdown" {
			if key == "pgup" {
				m.viewport.PageUp()
			} else {
				m.viewport.PageDown()
			}
			return m, nil
		}
		if key == "ctrl+r" {
			m.showReasoning = !m.showReasoning
			m.renderConversation(false)
			return m, nil
		}
		if key == "esc" && m.running {
			m.status = "正在停止并保存…"
			if m.cancel != nil {
				m.cancel()
			}
			return m, nil
		}
		if m.permission != nil {
			decision := map[string]string{"y": "allow-once", "a": "allow-always", "n": "deny"}[key]
			if decision != "" {
				m.permission.reply <- decision
				m.permission = nil
				m.status = "正在运行…"
				m.renderConversation(false)
			}
			return m, nil
		}
		if key == "enter" {
			if m.running || m.busy {
				return m, nil
			}
			text := strings.TrimSpace(m.input.Value())
			if text == "" {
				return m, nil
			}
			m.input.Reset()
			if strings.HasPrefix(text, "/") {
				return m, m.slash(text)
			}
			return m, m.begin("send", text)
		}
	}
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	return m, cmd
}

func (m *model) event(e api.Event) {
	switch e.Type {
	case "text-delta":
		m.liveText += e.Text
	case "reasoning-delta":
		m.liveReasoning += e.Text
	case "llm-start":
		if m.liveText != "" {
			m.liveLog += "\n" + m.liveText + "\n"
		}
		m.liveText = ""
		m.status = "正在请求模型…"
	case "llm-finish":
		if e.Text != "" {
			m.liveText = e.Text
		}
		var usage struct{ Input, Output, CacheRead, Reasoning int }
		if json.Unmarshal(e.Usage, &usage) == nil {
			m.status = fmt.Sprintf("输入 %d · 输出 %d · 缓存 %d · 思考 %d tokens", usage.Input, usage.Output, usage.CacheRead, usage.Reasoning)
		}
	case "tool-call":
		if m.liveText != "" {
			m.liveLog += "\n" + m.liveText + "\n"
			m.liveText = ""
		}
		if answer := chat.ControlAnswer(e.ToolName, e.Input); answer != "" {
			m.liveLog += "\n" + answer + "\n"
			m.lastControl = e.ToolCallID
		} else {
			m.liveLog += "\n[工具] " + e.ToolName + " " + string(e.Input) + "\n"
		}
	case "tool-result":
		if e.ToolCallID != m.lastControl {
			m.liveLog += "\n[结果] " + e.ToolName + "\n" + chat.Output(e.Output) + "\n"
		}
	case "tool-output":
		m.liveLog += chat.Output(e.Data)
	case "permission-blocked", "permission-limit":
		m.liveLog += "\n" + e.Reason + "\n"
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
