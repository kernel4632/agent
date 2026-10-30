// Package command exposes the scriptable CLI and the interactive chat entry.
package command

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"text/tabwriter"

	"github.com/kernel4632/agent/cli"
	"github.com/kernel4632/agent/cli/internal/api"
	"github.com/kernel4632/agent/cli/internal/chat"
	"github.com/kernel4632/agent/cli/internal/tui"
	"github.com/spf13/cobra"
)

type options struct {
	server string
	json   bool
}

func New() *cobra.Command {
	o := &options{}
	root := &cobra.Command{
		Use: "agent", Short: "Agent 项目的终端客户端", Version: cli.Version(),
		SilenceUsage: true, SilenceErrors: true,
	}
	address := os.Getenv("AGENT_SERVER_URL")
	if address == "" {
		address = "http://127.0.0.1:3000"
	}
	root.PersistentFlags().StringVar(&o.server, "server", address, "后端地址（或 AGENT_SERVER_URL）")
	root.PersistentFlags().BoolVar(&o.json, "json", false, "输出 JSON；ask 输出 NDJSON 事件")
	root.AddCommand(
		o.simple("health", "检查服务状态", "GET", "/health"),
		o.simple("tools", "列出工具和权限", "GET", "/tool/list"),
		o.models(), o.sessions(), o.ask(), o.interactive(),
	)
	return root
}

func (o *options) interactive() *cobra.Command {
	s := &sessionOptions{}
	cmd := &cobra.Command{Use: "chat", Short: "交互聊天：流式输出、工具审批和多轮对话", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		if o.json {
			return fmt.Errorf("chat 是交互界面；JSON 流使用 ask --json")
		}
		if err := tui.CheckTerminal(); err != nil {
			return err
		}
		client, err := o.client()
		if err != nil {
			return err
		}
		session, err := s.open(cmd.Context(), client)
		if err != nil {
			return err
		}
		return tui.Run(cmd.Context(), client, session)
	}}
	s.flags(cmd)
	return cmd
}

func (o *options) client() (*api.Client, error) { return api.New(o.server) }
func jsonOut(w io.Writer, data any) error       { return json.NewEncoder(w).Encode(data) }

func (o *options) simple(use, description, method, path string) *cobra.Command {
	return &cobra.Command{Use: use, Short: description, Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		client, err := o.client()
		if err != nil {
			return err
		}
		var data any
		if err = client.Request(cmd.Context(), method, path, nil, &data); err != nil {
			return err
		}
		return jsonOut(cmd.OutOrStdout(), data)
	}}
}

func (o *options) models() *cobra.Command {
	return &cobra.Command{Use: "models", Short: "列出已配置的供应商和模型", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		client, err := o.client()
		if err != nil {
			return err
		}
		var config api.Config
		if err = client.Request(cmd.Context(), "GET", "/config/read", nil, &config); err != nil {
			return err
		}
		rows := []map[string]any{}
		w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 4, 2, ' ', 0)
		if !o.json {
			fmt.Fprintln(w, "供应商\t模型\t名称\t启用")
		}
		for _, provider := range config.Providers {
			for _, model := range provider.Models {
				enabled := provider.Enabled == nil || *provider.Enabled
				rows = append(rows, map[string]any{"provider": provider.Name, "model": model.ID, "name": model.Name, "enabled": enabled})
				if !o.json {
					fmt.Fprintf(w, "%s\t%s\t%s\t%t\n", chat.Plain(provider.Name), chat.Plain(model.ID), chat.Plain(model.Name), enabled)
				}
			}
		}
		if o.json {
			return jsonOut(cmd.OutOrStdout(), rows)
		}
		return w.Flush()
	}}
}

func (o *options) sessions() *cobra.Command {
	root := &cobra.Command{Use: "sessions", Short: "管理与网页共用的会话"}
	var search string
	list := &cobra.Command{Use: "list", Short: "列出会话", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		client, err := o.client()
		if err != nil {
			return err
		}
		var sessions []api.Session
		if err = client.Request(cmd.Context(), "GET", "/session/list?search="+url.QueryEscape(search), nil, &sessions); err != nil {
			return err
		}
		if o.json {
			return jsonOut(cmd.OutOrStdout(), sessions)
		}
		w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 4, 2, ' ', 0)
		fmt.Fprintln(w, "ID\t标题\t模型\t目录")
		for _, s := range sessions {
			fmt.Fprintf(w, "%s\t%s\t%s/%s\t%s\n", s.ID, chat.Plain(s.Title), chat.Plain(s.Provider), chat.Plain(s.Model), chat.Plain(s.Cwd))
		}
		return w.Flush()
	}}
	list.Flags().StringVar(&search, "search", "", "搜索标题或模型")
	root.AddCommand(list)
	show := &cobra.Command{Use: "show ID", Short: "显示会话、历史和待审批工具", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		client, err := o.client()
		if err != nil {
			return err
		}
		s, err := client.Session(cmd.Context(), args[0])
		if err != nil {
			return err
		}
		if o.json {
			return jsonOut(cmd.OutOrStdout(), s)
		}
		fmt.Fprintf(cmd.OutOrStdout(), "%s  [%s]\n%s/%s · %s · reasoning=%s\n", chat.Plain(s.Title), s.ID, chat.Plain(s.Provider), chat.Plain(s.Model), chat.Plain(s.Cwd), s.Settings.Reasoning)
		for _, message := range s.History {
			if text := chat.MessageText(message, true); text != "" {
				fmt.Fprintf(cmd.OutOrStdout(), "\n[%s %s]\n%s\n", message.Role, message.MessageID, chat.Plain(text))
			}
		}
		for _, p := range s.Pending {
			fmt.Fprintf(cmd.OutOrStdout(), "\n待审批 %s %s %s\n", p.CallID, chat.Plain(p.Tool), chat.Plain(string(p.Input)))
		}
		return nil
	}}
	root.AddCommand(show)
	for _, spec := range []struct {
		use, short, action, method, field string
		count                             int
	}{
		{"rename ID TITLE", "修改标题", "rename", "PATCH", "title", 2},
		{"cwd ID PATH", "修改服务端当前目录", "cwd", "PATCH", "cwd", 2},
		{"reasoning ID LEVEL", "设置思考强度", "settings", "PATCH", "reasoning", 2},
		{"remove ID", "删除空闲会话", "remove", "DELETE", "", 1},
		{"fork ID", "复制会话为新分支", "fork", "POST", "", 1},
		{"changes ID", "查看文件改动", "changes", "GET", "", 1},
		{"compact ID", "压缩上下文", "compact", "POST", "", 1},
	} {
		root.AddCommand(&cobra.Command{Use: spec.use, Short: spec.short, Args: cobra.ExactArgs(spec.count), RunE: func(cmd *cobra.Command, args []string) error {
			client, err := o.client()
			if err != nil {
				return err
			}
			var body any
			if spec.field != "" {
				if spec.field == "reasoning" {
					if err := validReasoning(args[1]); err != nil {
						return err
					}
				}
				body = map[string]string{spec.field: args[1]}
			}
			var data any
			if err = client.Request(cmd.Context(), spec.method, api.SessionPath(spec.action, args[0]), body, &data); err != nil {
				return err
			}
			return jsonOut(cmd.OutOrStdout(), data)
		}})
	}
	root.AddCommand(&cobra.Command{Use: "model ID PROVIDER MODEL", Short: "切换会话模型", Args: cobra.ExactArgs(3), RunE: func(cmd *cobra.Command, args []string) error {
		client, err := o.client()
		if err != nil {
			return err
		}
		var data any
		if err = client.Request(cmd.Context(), "PATCH", api.SessionPath("model", args[0]), map[string]string{"provider": args[1], "model": args[2]}, &data); err != nil {
			return err
		}
		return jsonOut(cmd.OutOrStdout(), data)
	}})
	root.AddCommand(&cobra.Command{Use: "stop ID", Short: "停止任务", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		client, err := o.client()
		if err != nil {
			return err
		}
		return client.Stop(cmd.Context(), args[0], "", "")
	}})
	root.AddCommand(&cobra.Command{Use: "decide ID CALL_ID DECISION", Short: "审批：allow-once / allow-always / deny", Args: cobra.ExactArgs(3), RunE: func(cmd *cobra.Command, args []string) error {
		if args[2] != "allow-once" && args[2] != "allow-always" && args[2] != "deny" {
			return fmt.Errorf("decision 必须是 allow-once / allow-always / deny")
		}
		client, err := o.client()
		if err != nil {
			return err
		}
		return client.Decide(cmd.Context(), args[0], args[1], args[2])
	}})
	return root
}

func validReasoning(level string) error {
	for _, allowed := range []string{"off", "auto", "low", "medium", "high", "xhigh", "max"} {
		if level == allowed {
			return nil
		}
	}
	return fmt.Errorf("未知思考强度 %q，可用 off/auto/low/medium/high/xhigh/max", level)
}

type sessionOptions struct{ id, cwd, provider, model, reasoning, title string }

func (s *sessionOptions) flags(cmd *cobra.Command) {
	cmd.Flags().StringVarP(&s.id, "session", "s", "", "已有会话 ID；省略则创建新会话")
	cmd.Flags().StringVar(&s.cwd, "cwd", "", "新会话目录，默认本地当前目录；远程服务请指定远端目录")
	cmd.Flags().StringVar(&s.provider, "provider", "", "供应商名称")
	cmd.Flags().StringVar(&s.model, "model", "", "模型 ID")
	cmd.Flags().StringVar(&s.reasoning, "reasoning", "", "思考强度")
	cmd.Flags().StringVar(&s.title, "title", "新对话", "新会话标题")
}

func (s *sessionOptions) open(ctx context.Context, client *api.Client) (api.Session, error) {
	if s.reasoning != "" {
		if err := validReasoning(s.reasoning); err != nil {
			return api.Session{}, err
		}
	}
	if s.id == "" {
		cwd := s.cwd
		if cwd == "" {
			var err error
			cwd, err = os.Getwd()
			if err != nil {
				return api.Session{}, err
			}
		}
		var result struct {
			ID string `json:"sessionId"`
		}
		if err := client.Request(ctx, "POST", "/session/create", map[string]string{"title": s.title, "cwd": cwd, "provider": s.provider, "model": s.model}, &result); err != nil {
			return api.Session{}, err
		}
		s.id = result.ID
	} else {
		if s.cwd != "" {
			if err := client.Request(ctx, "PATCH", api.SessionPath("cwd", s.id), map[string]string{"cwd": s.cwd}, nil); err != nil {
				return api.Session{}, err
			}
		}
		if s.provider != "" || s.model != "" {
			if err := client.Request(ctx, "PATCH", api.SessionPath("model", s.id), map[string]string{"provider": s.provider, "model": s.model}, nil); err != nil {
				return api.Session{}, err
			}
		}
	}
	if s.reasoning != "" {
		if err := client.Request(ctx, "PATCH", api.SessionPath("settings", s.id), map[string]string{"reasoning": s.reasoning}, nil); err != nil {
			return api.Session{}, err
		}
	}
	return client.Session(ctx, s.id)
}

func (o *options) ask() *cobra.Command {
	s := &sessionOptions{}
	var permission string
	var resume bool
	cmd := &cobra.Command{Use: "ask [PROMPT]", Short: "单次提问；省略提示词时读取标准输入", Args: cobra.MaximumNArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		if permission != "ask" && permission != "deny" && permission != "allow-once" {
			return fmt.Errorf("--permission 必须是 ask / deny / allow-once")
		}
		input := ""
		if resume {
			if s.id == "" || len(args) != 0 {
				return fmt.Errorf("--resume 需要 --session，且不能附带提示词")
			}
		} else {
			if len(args) > 0 {
				input = args[0]
			} else {
				if f, ok := cmd.InOrStdin().(*os.File); ok {
					if info, _ := f.Stat(); info != nil && info.Mode()&os.ModeCharDevice != 0 {
						return fmt.Errorf("请提供提示词或通过管道输入")
					}
				}
				data, err := io.ReadAll(io.LimitReader(cmd.InOrStdin(), 8*1024*1024+1))
				if err != nil {
					return err
				}
				if len(data) > 8*1024*1024 {
					return fmt.Errorf("输入超过 8 MiB")
				}
				input = string(data)
			}
			if strings.TrimSpace(input) == "" {
				return fmt.Errorf("提示词不能为空")
			}
		}
		client, err := o.client()
		if err != nil {
			return err
		}
		ctx, cancel := signal.NotifyContext(cmd.Context(), os.Interrupt)
		defer cancel()
		session, err := s.open(ctx, client)
		if err != nil {
			return err
		}
		if session.Running {
			return fmt.Errorf("会话正在运行，使用 chat --session %s 连接", session.ID)
		}
		fmt.Fprintln(cmd.ErrOrStderr(), "会话:", session.ID)
		baseline := len(session.History)
		action := "send"
		if resume {
			action = "resume"
		}
		err = chat.Run(ctx, client, session, action, input, chat.Hooks{
			Event: func(event api.Event) {
				if o.json {
					_ = jsonOut(cmd.OutOrStdout(), event)
				}
			},
			Snapshot: func(snapshot api.Session) {
				if o.json {
					_ = jsonOut(cmd.OutOrStdout(), map[string]any{"type": "snapshot", "session": snapshot})
				}
			},
			Permission: func(ctx context.Context, p api.Permission) error {
				if permission == "ask" {
					fmt.Fprintf(cmd.ErrOrStderr(), "待审批: %s %s\n使用 agent sessions decide %s %s allow-once（或 deny），再用 chat --session %s 连接。\n", p.Tool, chat.Plain(string(p.Input)), session.ID, p.CallID, session.ID)
					return chat.ErrPending
				}
				return client.Decide(ctx, session.ID, p.CallID, permission)
			},
		})
		if err != nil {
			return err
		}
		final, err := client.Session(ctx, session.ID)
		if err != nil {
			return err
		}
		if o.json {
			return jsonOut(cmd.OutOrStdout(), map[string]any{"type": "result", "session": final})
		}
		for i, message := range final.History {
			if i < baseline || message.Role != "assistant" {
				continue
			}
			if text := chat.MessageText(message, false); text != "" {
				fmt.Fprintln(cmd.OutOrStdout(), chat.Plain(text))
			}
		}
		return nil
	}}
	s.flags(cmd)
	cmd.Flags().StringVar(&permission, "permission", "ask", "遇到审批时退出等待 / 拒绝 / 允许本次：ask|deny|allow-once")
	cmd.Flags().BoolVar(&resume, "resume", false, "继续被中断的助手回复")
	return cmd
}
