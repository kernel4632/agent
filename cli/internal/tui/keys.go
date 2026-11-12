/*
键盘路由：全局键 → 输入框补全 → 对话区选中块。
审批、停止、退出这些不分焦点的键写在 handleKey 开头，避免被下层吃掉。
*/
package tui

import (
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/atotto/clipboard"
)

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
		m.rebuild()
		show := !m.anyReasoningOpen()
		m.showReasoning = show
		for _, item := range m.blocks {
			if item.kind == "reasoning" {
				m.open[item.id] = show // 连正在生成的那块一起定住，按一次就看得到变化
			}
		}
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
		decision := map[string]string{"y": "allow", "n": "deny"}[key]
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
