/*
目录浏览器：列当前目录、翻上级、进子目录、选定后写回会话。
路径由服务端解析，所以每进一层都重新请求一次。
*/
package tui

import (
	"net/url"
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/kernel4632/agent/cli/internal/api"
)

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

func (m *model) cwdText() string {
	var b strings.Builder
	current := ""
	if m.overlay.dir != nil {
		current = m.overlay.dir.Current
	}
	b.WriteString(accent.Render("目录") + dim.Render(" · ") + gold.Render(current) + "\n")
	b.WriteString(dim.Render("Enter 进入或使用 · Backspace 上级 · Esc 关闭") + "\n\n")
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
	return strings.TrimRight(b.String(), "\n")
}

func (m *model) activateCwd() tea.Cmd {
	items := m.visibleDirs()
	if m.overlay.index < 0 || m.overlay.index >= len(items) {
		return nil
	}
	item := items[m.overlay.index]
	if item.kind == "use" {
		return m.patchSession("cwd", map[string]string{"cwd": item.path})
	}
	return m.loadDir(item.path)
}
