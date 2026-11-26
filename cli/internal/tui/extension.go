/*
扩展挂载：把扩展在 manifest.json 里声明的 cli（commands / shortcut / topbar / view）挂进交互界面。

CLI 是编译好的 Go 客户端，不执行扩展代码；挂载方式是声明式的——
对标网页端 `app.topbar.add()` / `app.panels.add()` / 注册表与按拥有者整体撤除：
这里把扩展命令、快捷键和顶栏状态条放进挂载表，重挂时整表重建，停用或重载后立即消失。

数据流：Init 时随 loadMeta 拉一次清单；/extensions 浮层里开关或重载后，
拿到新清单整表重建。执行命令优先按 tool 从本地工具输出渲染，或转发 POST /admin。

调用示例：

	m.mountExtensions(state)                       // 拿到 extension.list 的结果后重建挂载表
	return m.runExtensionCommand(decl, "m1")       // 执行一条扩展命令
*/
package tui

import (
	"encoding/json"
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/kernel4632/agent/cli/internal/api"
	"github.com/kernel4632/agent/cli/internal/render"
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

type extResultMsg struct {
	owner   string
	command api.ExtensionCommand
	data    any
	err     error
}

type extTopbarBinding struct {
	extName string
	spec    api.ExtensionTopbar
}

// --- 挂载表：命令、快捷键和顶栏状态条整表重建，不做增量增删 ---

func (m *model) mountExtensions(state api.ExtensionState) {
	m.extensions = state
	m.extCommands = map[string]api.ExtensionCommand{}
	m.extOwners = map[string]string{}
	m.extShortcuts = map[string]api.ExtensionCommand{}
	m.extTopbars = nil
	runningOwners := map[string]bool{}
	for _, item := range state.Extensions {
		if !item.Running {
			continue // 没在生效的扩展不挂任何东西；清单本身仍能在 /extensions 里看到
		}
		runningOwners[item.Name] = true
		for _, bar := range item.Cli.Topbar {
			if bar.Tool != "" {
				m.extTopbars = append(m.extTopbars, extTopbarBinding{extName: item.Name, spec: bar})
			}
		}
		for _, command := range item.Cli.Commands {
			if command.Name == "" || isBuiltinSlash("/"+command.Name) {
				continue // 内置斜杠命令不可被扩展覆盖
			}
			m.extCommands[command.Name] = command
			m.extOwners[command.Name] = item.Name
			if shortcut := strings.ToLower(strings.TrimSpace(command.Shortcut)); shortcut != "" && !isBuiltinGlobalKey(shortcut) {
				m.extShortcuts[shortcut] = command
			}
		}
	}
	if m.overlay.kind == "ext" && m.overlay.extName != "" && !runningOwners[m.overlay.extName] {
		m.closeOverlay()
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
			if command.Name == "" || isBuiltinSlash("/"+command.Name) {
				continue
			}
			hint := command.Hint
			if hint == "" {
				hint = item.Title
			}
			if command.Shortcut != "" {
				hint += " [" + command.Shortcut + "]"
			}
			usage := strings.TrimSpace(command.Usage)
			runBare := usage == "" || strings.HasPrefix(usage, "[")
			list = append(list, slashCommand{Name: "/" + command.Name, Hint: hint, Usage: command.Usage, RunBare: runBare})
		}
	}
	return list
}

// extTopbarLines 渲染所有扩展挂载的顶栏状态行（无匹配工具输出时不占空间）。
func (m *model) extTopbarLines() []string {
	var lines []string
	for _, binding := range m.extTopbars {
		if m.overlay.kind == "ext" && m.overlay.extName == binding.extName {
			continue
		}
		if text := render.FormatExtensionTopbar(binding.spec, m.toolOutputs[binding.spec.Tool]); text != "" {
			lines = append(lines, text)
		}
	}
	return lines
}

// findExtCommand 按输入的 /name 找一条扩展命令声明。
func (m *model) findExtCommand(name string) (api.ExtensionCommand, bool) {
	command, ok := m.extCommands[strings.TrimPrefix(name, "/")]
	return command, ok
}

// --- 执行：有 view 声明进通用扩展浮层，其余像 /sessions 一样写进 panel ---

func (m *model) runExtensionCommand(command api.ExtensionCommand, argument string) tea.Cmd {
	owner := m.extOwners[command.Name]
	// 若声明了 tool 且当前已有本地结果（或无 op 可调），直接从会话工具输出渲染，不依赖往返请求。
	if command.Tool != "" && (len(m.toolOutputs[command.Tool]) > 0 || command.Op == "" || m.client == nil) {
		var decoded any
		if raw := m.toolOutputs[command.Tool]; len(raw) > 0 {
			decoded = json.RawMessage(raw)
		}
		if command.View != nil {
			m.openExtOverlay(owner, command, decoded)
			return nil
		}
		m.panel = render.FormatExtensionView(nil, decoded)
		m.renderConversation(true)
		return nil
	}
	if m.client == nil {
		m.notice = "没有连接"
		m.renderConversation(false)
		return nil
	}
	body, err := api.ExtensionBody(command, m.session.ID, m.session.Cwd, argument)
	if err != nil {
		m.notice = err.Error()
		m.renderConversation(false)
		return nil
	}
	if !command.NoSession {
		sid, _ := body["sessionId"].(string)
		if strings.TrimSpace(sid) == "" {
			m.notice = "没有当前会话"
			m.renderConversation(false)
			return nil
		}
	}
	if usage := strings.TrimSpace(command.Usage); usage != "" && !strings.HasPrefix(usage, "[") && strings.TrimSpace(argument) == "" {
		m.notice = "用法: /" + command.Name + " " + usage
		m.renderConversation(false)
		return nil
	}
	if command.Op == "" {
		m.notice = "/" + command.Name + " 未声明服务端动作"
		m.renderConversation(false)
		return nil
	}

	client, ctx := m.client, m.ctx
	m.busy = true
	m.notice = "处理中…"
	return func() tea.Msg {
		var result any // op 想返回什么就返回什么，照实显示或交给 view 渲染
		err := client.Admin(ctx, command.Op, api.AdminArgs(body), &result)
		if command.View != nil {
			return extResultMsg{owner: owner, command: command, data: result, err: err}
		}
		if err != nil {
			return commandMsg{err: err}
		}
		return commandMsg{text: render.FormatExtensionView(nil, result)}
	}
}

func (m *model) openExtOverlay(owner string, command api.ExtensionCommand, data any) {
	m.overlay = overlayState{
		kind:    "ext",
		extName: owner,
		extCmd:  command.Name,
		extText: render.FormatExtensionView(command.View, data),
	}
	m.focus = focusOverlay
	m.input.Blur()
	m.renderConversation(true)
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
	if item == nil || m.client == nil {
		return nil
	}
	m.busy = true
	return m.toggleExtension(item.Name, !item.Enabled)
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
		b.WriteString(line + "  " + render.ExtensionStatus(item, false) + "\n")
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
