package tui

import (
	"context"
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/kernel4632/agent/cli/internal/api"
)

const help = `命令
/sessions                 列出会话
/open ID                  打开会话（运行中会自动连接）
/new [标题]               新建会话
/model 供应商 模型        切换模型，agent models 可列出可用项
/reasoning 强度           off/auto/low/medium/high/xhigh/max
/cwd 路径                 修改服务端当前目录，路径无需引号
/rename 标题              修改标题
/resume                   继续被中断的助手
/refresh                  重新读取服务端历史
/quit                     退出

Enter 发送；Alt+Enter / Ctrl+J 换行；PgUp/PgDn 滚动
Ctrl+R 显示/收起思考；Esc / Ctrl+C 停止；Ctrl+Q 停止并退出
审批期间：y 允许一次，a 始终允许（保存全局规则），n 拒绝
同一会话只保留一个实时连接，请关闭网页中该会话的实时页面。`

func (m *model) slash(text string) tea.Cmd {
	name, argument, _ := strings.Cut(text, " ")
	argument = strings.TrimSpace(argument)
	switch name {
	case "/help":
		m.panel = help
		m.renderConversation(true)
		return nil
	case "/quit":
		return tea.Quit
	case "/resume":
		return m.begin("resume", "")
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
		fields := strings.Fields(argument)
		if len(fields) != 2 {
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
