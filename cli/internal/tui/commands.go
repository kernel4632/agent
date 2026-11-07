/*
TUI 快捷命令：解析输入框里的 /command，调用服务端并返回新会话给界面。
所有网络操作都在这里完成，model.Update 只接收 commandMsg，不直接发请求。
调用示例：

	execute(ctx, client, session, "/reasoning", "high")
	execute(ctx, client, session, "/model", `"provider with spaces" model`)
*/
package tui

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	tea "charm.land/bubbletea/v2"
	"github.com/kernel4632/agent/cli/internal/api"
)

func (m *model) slash(text string) tea.Cmd {
	name, argument, _ := strings.Cut(text, " ")
	argument = strings.TrimSpace(argument)
	switch name {
	case "/help":
		m.panel = commandHelp()
		m.renderConversation(true)
		return nil
	case "/quit":
		return tea.Quit
	case "/resume":
		return m.begin("resume", "")
	case "/sessions":
		return m.openSessions()
	case "/changes":
		return m.openChanges()
	case "/todos":
		m.openTodos()
		return nil
	case "/usage":
		m.openStats()
		return nil
	case "/copy":
		m.rebuild()
		return m.copyTarget()
	case "/rollback":
		messageID, _ := m.targetIDs()
		return m.confirmRollback(messageID, "")
	case "/redo":
		return m.doRedo()
	case "/fork":
		messageID, _ := m.targetIDs()
		return m.doFork(messageID)
	case "/title":
		return m.doTitle()
	case "/model":
		if argument == "" {
			return m.openModels()
		}
	case "/reasoning":
		if argument == "" {
			return m.openReasoning()
		}
	case "/cwd":
		if argument == "" {
			return m.openCwd()
		}
	}
	client, session, ctx := m.client, m.session, m.ctx
	m.busy = true
	m.notice = "处理中…"
	return func() tea.Msg {
		saved, result, err := execute(ctx, client, session, name, argument)
		return commandMsg{session: saved, text: result, err: err}
	}
}

func execute(ctx context.Context, client *api.Client, session api.Session, name, argument string) (api.Session, string, error) {
	fail := func(text string) (api.Session, string, error) { return api.Session{}, "", fmt.Errorf("%s", text) }
	id := session.ID
	var err error
	switch name {
	case "/sessions":
		var list []api.Session
		err = client.Request(ctx, "GET", "/session/list", nil, &list)
		if err != nil {
			return api.Session{}, "", err
		}
		var lines []string
		for _, item := range list {
			lines = append(lines, item.ID+"  "+item.Title)
		}
		return api.Session{}, strings.Join(lines, "\n"), nil
	case "/open":
		if argument == "" {
			return fail("用法: /open SESSION_ID")
		}
		id = argument
	case "/new":
		if argument == "" {
			argument = "新对话"
		}
		var created struct {
			ID string `json:"sessionId"`
		}
		err = client.Request(ctx, "POST", "/session/create", map[string]string{"title": argument, "cwd": session.Cwd, "provider": session.Provider, "model": session.Model}, &created)
		id = created.ID
	case "/model":
		fields, parseErr := modelArguments(argument)
		if parseErr != nil || len(fields) != 2 || fields[0] == "" || fields[1] == "" {
			return fail("用法: /model PROVIDER MODEL（可用 agent models 列出）")
		}
		err = client.Request(ctx, "PATCH", api.SessionPath("model", id), map[string]string{"provider": fields[0], "model": fields[1]}, nil)
	case "/reasoning":
		valid := false
		for _, level := range []string{"off", "auto", "low", "medium", "high", "xhigh", "max"} {
			if level == argument {
				valid = true
			}
		}
		if !valid {
			return fail("思考强度: off / auto / low / medium / high / xhigh / max")
		}
		err = client.Request(ctx, "PATCH", api.SessionPath("settings", id), map[string]string{"reasoning": argument}, nil)
	case "/cwd", "/rename":
		if argument == "" {
			return fail("用法: " + name + " 值")
		}
		field, action := "cwd", "cwd"
		if name == "/rename" {
			field, action = "title", "rename"
		}
		err = client.Request(ctx, "PATCH", api.SessionPath(action, id), map[string]string{field: argument}, nil)
	case "/refresh":
	default:
		return fail("未知命令，输入 /help 查看")
	}
	if err != nil {
		return api.Session{}, "", err
	}
	saved, err := client.Session(ctx, id)
	return saved, "", err
}

// modelArguments 只按“单词 + 可选的单/双引号”切分，不经过 shell：
// 模型名里的 /、反斜杠和 Windows 路径都原样保留；引号只为包含空格。
func modelArguments(argument string) ([]string, error) {
	var fields []string
	var word strings.Builder
	var quote rune
	started := false
	for _, ch := range argument {
		if quote != 0 {
			if ch == quote {
				quote = 0 // 结束当前引号
			} else {
				word.WriteRune(ch) // 引号内的空格原样保留
			}
		} else if ch == '"' || ch == '\'' {
			quote, started = ch, true // 进入引号；空引号也算一个参数
		} else if unicode.IsSpace(ch) {
			if started {
				fields = append(fields, word.String()) // 空白结束一个参数
				word.Reset()
				started = false
			}
		} else {
			word.WriteRune(ch) // 普通字符原样写入
			started = true
		}
	}
	if quote != 0 {
		return nil, fmt.Errorf("名称引号未闭合")
	}
	if started {
		fields = append(fields, word.String())
	}
	return fields, nil
}
