/*
模型与思考强度的选择器，以及启动时读取服务端配置（模型列表就来自这里）。
选定模型后接着打开思考强度，两步一次走完。
*/
package tui

import (
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/kernel4632/agent/cli/internal/api"
)

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

var reasoningLevels = []string{"off", "auto", "low", "medium", "high", "xhigh", "max"}

func (m *model) modelsText() string {
	var b strings.Builder
	b.WriteString(accent.Render("模型"))
	if m.overlay.filter != "" {
		b.WriteString(dim.Render(" · 筛选 " + m.overlay.filter))
	}
	b.WriteString("\n\n")
	list := m.visibleModels()
	if len(list) == 0 {
		b.WriteString(dim.Render("没有已配置的模型"))
		return strings.TrimRight(b.String(), "\n")
	}
	for i, model := range list {
		mark := "  "
		chosen := i == m.overlay.index
		if chosen {
			mark = "▸ "
		}
		row := mark + model.provider + "/" + model.id
		if model.name != model.id {
			row += "  " + model.name
		}
		if chosen {
			row = accent.Render(row)
		}
		if model.provider == m.session.Provider && model.id == m.session.Model {
			row += okText.Render("  ←")
		}
		b.WriteString(row + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (m *model) reasoningText() string {
	var b strings.Builder
	b.WriteString(accent.Render("思考强度") + "\n\n")
	for i, level := range reasoningLevels {
		mark := "  "
		if i == m.overlay.index {
			mark = "▸ "
		}
		row := mark + level
		if i == m.overlay.index {
			row = accent.Render(row)
		}
		if level == m.session.Settings.Reasoning {
			row += okText.Render("  ←")
		}
		b.WriteString(row + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (m *model) activateModel() tea.Cmd {
	list := m.visibleModels()
	if m.overlay.index < 0 || m.overlay.index >= len(list) {
		return nil
	}
	choice := list[m.overlay.index]
	m.pendingReasoning = true // 选完模型接着选思考强度，两步一次走完
	return m.patchSession("model", map[string]string{"provider": choice.provider, "model": choice.id})
}

func (m *model) activateReasoning() tea.Cmd {
	if m.overlay.index < 0 || m.overlay.index >= len(reasoningLevels) {
		return nil
	}
	return m.patchSession("settings", map[string]string{"reasoning": reasoningLevels[m.overlay.index]})
}
