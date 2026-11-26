/*
扩展挂载：把扩展在 manifest.json 里声明的 cli.commands 挂进交互界面。

CLI 是编译好的 Go 客户端，不执行扩展代码；挂载方式是声明式的——
扩展声明「斜杠命令 → /admin 动作」，界面按清单把命令并进斜杠菜单。
形态和网页端一致：网页把扩展前端注册进面板/顶栏再按拥有者整体撤除，
这里把扩展命令注册进挂载表，重挂时整表重建，停用的扩展自然消失。

数据流：Init 时随 loadMeta 拉一次清单；/extensions 浮层里开关或重载后，
拿到新清单整表重建。执行命令走 /admin，结果回给 commandMsg 显示。

调用示例：

	m.mountExtensions(state)                       // 拿到 extension.list 的结果后重建挂载表
	return m.runExtensionCommand(decl, "m1")       // 执行一条扩展命令
*/
package tui

import (
	"encoding/json"
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/kernel4632/agent/cli/internal/api"
)

type extensionMsg struct {
	state api.ExtensionState
	err   error
}

type extensionToggleMsg struct {
	name    string
	enabled bool
	state   api.ExtensionState
	err     error
}

type extensionReloadMsg struct {
	name  string
	state api.ExtensionState
	err   error
}

// --- 挂载表：命令名 → 声明；整表重建，不做增量增删 ---

func (m *model) mountExtensions(state api.ExtensionState) {
	m.extensions = state
	m.extCommands = map[string]api.ExtensionCommand{}
	for _, item := range state.Extensions {
		if !item.Running {
			continue // 没在生效的扩展不挂命令；清单本身仍能在 /extensions 里看到
		}
		for _, command := range item.Cli.Commands {
			m.extCommands[command.Name] = command
		}
	}
}

// extSlashCommands 把扩展命令转成斜杠菜单条目，排在内置命令后面。
func (m *model) extSlashCommands() []slashCommand {
	var list []slashCommand
	for _, item := range m.extensions.Extensions {
		if !item.Running {
			continue
		}
		for _, command := range item.Cli.Commands {
			hint := command.Hint
			if hint == "" {
				hint = item.Title
			}
			list = append(list, slashCommand{Name: "/" + command.Name, Hint: hint, Usage: command.Usage, RunBare: false})
		}
	}
	return list
}

// findExtCommand 按输入的 /name 找一条扩展命令声明。
func (m *model) findExtCommand(name string) (api.ExtensionCommand, bool) {
	command, ok := m.extCommands[strings.TrimPrefix(name, "/")]
	return command, ok
}

// --- 执行：结果像 /sessions 一样写进 panel，不进对话记录 ---

func (m *model) runExtensionCommand(command api.ExtensionCommand, argument string) tea.Cmd {
	client, ctx := m.client, m.ctx
	sessionID := m.session.ID
	return func() tea.Msg {
		var result any   // op 想返回什么就返回什么，照实显示
		body := api.ExtensionBody(command, sessionID, argument)
		err := client.Admin(ctx, command.Op, api.AdminArgs(body), &result)
		if err != nil {
			return commandMsg{text: err.Error()}
		}
		return commandMsg{text: extensionResultText(result)}
	}
}

// extensionResultText 把 /admin 的返回值拼成可读文本：JSON 缩进两格，和 agent extensions call 的一致。
func extensionResultText(result any) string {
	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", result)
	}
	return string(encoded)
}

// --- 清单与开关：/extensions 浮层和它背后的三个网络动作 ---

func (m *model) fetchExtensions() tea.Cmd {
	if m.client == nil {
		return nil
	}
	client, ctx := m.client, m.ctx
	return func() tea.Msg {
		var state api.ExtensionState
		err := client.Admin(ctx, "extension.list", nil, &state)
		return extensionMsg{state: state, err: err}
	}
}

func (m *model) toggleExtension(name string, enabled bool) tea.Cmd {
	if m.client == nil {
		return nil
	}
	client, ctx := m.client, m.ctx
	return func() tea.Msg {
		var state api.ExtensionState
		err := client.Admin(ctx, "extension.toggle", api.AdminArgs{"name": name, "enabled": enabled}, &state)
		return extensionToggleMsg{name: name, enabled: enabled, state: state, err: err}
	}
}

func (m *model) reloadExtension(name string) tea.Cmd {
	if m.client == nil {
		return nil
	}
	client, ctx := m.client, m.ctx
	return func() tea.Msg {
		var state api.ExtensionState
		err := client.Admin(ctx, "extension.reload", api.AdminArgs{"name": name}, &state)
		return extensionReloadMsg{name: name, state: state, err: err}
	}
}

func (m *model) openExtensions() tea.Cmd {
	m.overlay = overlayState{kind: "extensions", loading: true}
	m.focus = focusOverlay
	m.input.Blur()
	m.renderConversation(true)
	return m.fetchExtensions()
}

// pickedExtension 浮层里当前选中的扩展；越界时返回 nil。
func (m *model) pickedExtension() *api.Extension {
	if m.overlay.index < 0 || m.overlay.index >= len(m.extensions.Extensions) {
		return nil
	}
	return &m.extensions.Extensions[m.overlay.index]
}

// togglePickedExtension 开/关选中的扩展。关掉被依赖的扩展会连带停掉依赖方，服务端处理。
func (m *model) togglePickedExtension() tea.Cmd {
	item := m.pickedExtension()
	if item == nil {
		return nil
	}
	m.busy = true
	return m.toggleExtension(item.Name, !item.Enabled)
}

// extensionStatus 一行状态：错误优先，然后是关闭/更新/运行。
func extensionStatus(item api.Extension) string {
	state := "未运行"
	switch {
	case item.Error != "":
		state = item.Error
	case !item.Enabled:
		state = "已关闭"
	case item.Running:
		state = "运行中"
	}
	if item.Changed && item.Enabled {
		state += " · 有更新"
	}
	return state
}

// extensionPanelText 扩展清单的纯文本（panel 用），给无法打开浮层时的回显。
func extensionPanelText(state api.ExtensionState) string {
	if len(state.Extensions) == 0 {
		return "没有扩展。扩展放在项目的 extensions/ 或 ~/.agents/extensions/ 里。"
	}
	var b strings.Builder
	for _, item := range state.Extensions {
		line := item.Title
		if item.Version != "" {
			line += " " + item.Version
		}
		b.WriteString(line + "  " + extensionStatus(item) + "\n")
		for _, command := range item.Cli.Commands {
			mark := " "
			if item.Running {
				mark = "/"
			}
			b.WriteString("  " + mark + command.Name + "  " + command.Hint + "\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}
