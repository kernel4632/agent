/*
额外命令：把服务器已经提供、但 CLI 还没露出的接口接上命令行。
包括用量统计、改动列表、回退、MCP / 技能 / 工具目录、目录浏览和会话压缩。
这些命令只做“取参数 → 请求 → 渲染”，业务判断都在服务器；
渲染细节在 internal/render，不写在这里。

调用示例：

	agent usage SESSION_ID
	agent changes SESSION_ID --json
	agent tools
*/
package command

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/kernel4632/agent/cli/internal/api"
	"github.com/kernel4632/agent/cli/internal/chat"
	"github.com/kernel4632/agent/cli/internal/render"
	"github.com/spf13/cobra"
)

func (o *options) emit(cmd *cobra.Command, data any, human func(io.Writer) error) error {
	if o.json {
		return jsonOut(cmd.OutOrStdout(), data)
	}
	return human(cmd.OutOrStdout())
}

func (o *options) health() *cobra.Command {
	return &cobra.Command{Use: "health", Short: "检查服务状态", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		client, err := o.client()
		if err != nil {
			return err
		}
		var health api.Health
		if err = client.Request(cmd.Context(), "GET", "/health", nil, &health); err != nil {
			return err
		}
		return o.emit(cmd, health, func(w io.Writer) error {
			state := "正常"
			if !health.OK {
				state = "异常"
			}
			fmt.Fprintf(w, "状态\t%s\n版本\t%s\n", state, health.Version)
			if health.TargetVersion != "" && health.TargetVersion != health.Version {
				fmt.Fprintf(w, "磁盘版本\t%s\n", health.TargetVersion)
			}
			if health.RestartRequired {
				fmt.Fprintln(w, "需要重启\t是")
			}
			fmt.Fprintf(w, "会话\t%d\n运行中\t%d\n", health.Sessions, health.Running)
			return nil
		})
	}}
}

func (o *options) tools() *cobra.Command {
	return &cobra.Command{Use: "tools", Short: "列出工具和权限", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		client, err := o.client()
		if err != nil {
			return err
		}
		var tools []api.Tool
		if err = client.Admin(cmd.Context(), "tool.list", nil, &tools); err != nil {
			return err
		}
		return o.emit(cmd, tools, func(w io.Writer) error {
			tw := table(w)
			fmt.Fprintln(tw, "名称\t类别\t权限\t摘要")
			for _, tool := range tools {
				summary := tool.UI.Title
				if tool.UI.Summary != "" {
					if summary != "" {
						summary += " · "
					}
					summary += tool.UI.Summary
				}
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", tool.Name, chat.Plain(tool.KindLabel), tool.Permission, chat.Plain(summary))
			}
			return tw.Flush()
		})
	}}
}

func (o *options) configCmd() *cobra.Command {
	root := &cobra.Command{Use: "config", Short: "检查模型配置"}
	root.AddCommand(&cobra.Command{
		Use: "test [PROVIDER] [MODEL]", Short: "用已保存的配置真实请求一次模型",
		Args: cobra.MaximumNArgs(2), RunE: func(cmd *cobra.Command, args []string) error {
			client, err := o.client()
			if err != nil {
				return err
			}
			body := api.AdminArgs{}
			if len(args) > 0 {
				body["provider"] = args[0]
			}
			if len(args) > 1 {
				body["model"] = args[1]
			}
			var result struct {
				OK       bool   `json:"ok"`
				Provider string `json:"provider"`
				Model    string `json:"model"`
				Text     string `json:"text"`
			}
			if err = client.Admin(cmd.Context(), "config.test", body, &result); err != nil {
				return err
			}
			return o.emit(cmd, result, func(w io.Writer) error {
				fmt.Fprintf(w, "可用\t%s/%s\n", result.Provider, result.Model)
				text := strings.TrimSpace(result.Text)
				if text != "" {
					fmt.Fprintln(w, render.Clip(chat.Plain(text), 20))
				}
				return nil
			})
		},
	})
	return root
}

func (o *options) mcp() *cobra.Command {
	root := &cobra.Command{Use: "mcp", Short: "查看和开关 MCP 服务"}
	var cwd string
	list := &cobra.Command{Use: "list", Short: "列出已配置的服务和本机识别到的服务", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		client, err := o.client()
		if err != nil {
			return err
		}
		path := "/mcp/list"
		if cwd != "" {
			path += "?cwd=" + url.QueryEscape(cwd)
		}
		var catalog api.MCPCatalog
		if err = client.Request(cmd.Context(), "GET", path, nil, &catalog); err != nil {
			return err
		}
		safe := struct {
			Servers  []api.MCPServer   `json:"servers"`
			Detected []api.MCPDetected `json:"detected"`
		}{Servers: catalog.Servers, Detected: catalog.Detected.Servers}
		return o.emit(cmd, safe, func(w io.Writer) error {
			if len(catalog.Servers) == 0 {
				fmt.Fprintln(w, "没有已配置的 MCP 服务")
			} else {
				tw := table(w)
				fmt.Fprintln(tw, "名称\t状态\t地址")
				for _, server := range catalog.Servers {
					state := "停用"
					if server.Enabled {
						state = "启用"
					}
					if server.Error != "" {
						state = "失败"
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\n", chat.Plain(server.Name), state, chat.Plain(mcpWhere(server)))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
			}
			if len(catalog.Detected.Servers) == 0 {
				return nil
			}
			fmt.Fprintln(w, "\n本机识别到、尚未导入：")
			for _, item := range catalog.Detected.Servers {
				mark := "未导入"
				if item.Configured {
					mark = "已有同名配置"
				}
				fmt.Fprintf(w, "  %s\t%s\t%s\n", chat.Plain(item.Name), chat.Plain(item.App), mark)
			}
			return nil
		})
	}}
	list.Flags().StringVar(&cwd, "cwd", "", "识别项目级 MCP 时使用的服务端目录")
	root.AddCommand(list)
	root.AddCommand(&cobra.Command{
		Use: "toggle NAME on|off", Short: "启用或停用一个 MCP 服务", Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			enabled, err := onOff(args[1])
			if err != nil {
				return err
			}
			client, err := o.client()
			if err != nil {
				return err
			}
			var result any
			if err = client.Admin(cmd.Context(), "mcp.toggle", api.AdminArgs{"name": args[0], "enabled": enabled}, &result); err != nil {
				return err
			}
			return o.emit(cmd, result, func(w io.Writer) error {
				state := "已停用"
				if enabled {
					state = "已启用"
				}
				fmt.Fprintf(w, "%s %s\n", chat.Plain(args[0]), state)
				return nil
			})
		},
	})
	root.AddCommand(&cobra.Command{
		Use: "test NAME", Short: "真实连接一次并列出工具名", Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client, err := o.client()
			if err != nil {
				return err
			}
			var result struct {
				OK    bool     `json:"ok"`
				Name  string   `json:"name"`
				Tools []string `json:"tools"`
				Error string   `json:"error"`
			}
			if err = client.Admin(cmd.Context(), "mcp.test", api.AdminArgs{"name": args[0]}, &result); err != nil {
				return err
			}
			return o.emit(cmd, result, func(w io.Writer) error {
				if !result.OK {
					fmt.Fprintf(w, "%s 连接失败：%s\n", chat.Plain(result.Name), chat.Plain(result.Error))
					return fmt.Errorf("MCP 连接失败")
				}
				fmt.Fprintf(w, "%s 已连接，%d 个工具\n", chat.Plain(result.Name), len(result.Tools))
				for _, name := range result.Tools {
					fmt.Fprintf(w, "  %s\n", chat.Plain(name))
				}
				return nil
			})
		},
	})
	return root
}

func (o *options) skills() *cobra.Command {
	root := &cobra.Command{Use: "skills", Short: "查看和开关技能"}
	var cwd string
	list := &cobra.Command{Use: "list", Short: "列出当前生效的技能", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		client, err := o.client()
		if err != nil {
			return err
		}
		target, err := serverCwd(cwd)
		if err != nil {
			return err
		}
		var catalog struct {
			Skills []api.Skill `json:"skills"`
		}
		if err = client.Admin(cmd.Context(), "skill.list", api.AdminArgs{"cwd": target}, &catalog); err != nil {
			return err
		}
		return o.emit(cmd, catalog.Skills, func(w io.Writer) error {
			if len(catalog.Skills) == 0 {
				fmt.Fprintln(w, "没有技能")
				return nil
			}
			tw := table(w)
			fmt.Fprintln(tw, "名称\t状态\t来源\t说明")
			for _, skill := range catalog.Skills {
				state := "停用"
				if skill.Enabled {
					state = "启用"
				}
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", chat.Plain(skill.Name), state, chat.Plain(skill.SourceLabel), chat.Plain(oneLine(skill.Description, 60)))
			}
			return tw.Flush()
		})
	}}
	list.Flags().StringVar(&cwd, "cwd", "", "服务端上的项目目录，默认本机当前目录")
	root.AddCommand(list)
	toggle := &cobra.Command{
		Use: "toggle NAME on|off", Short: "把技能从模型清单里拿掉或放回来", Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			enabled, err := onOff(args[1])
			if err != nil {
				return err
			}
			client, err := o.client()
			if err != nil {
				return err
			}
			target, err := serverCwd(cwd)
			if err != nil {
				return err
			}
			var result any
			body := map[string]any{"name": args[0], "enabled": enabled, "cwd": target}
			if err = client.Admin(cmd.Context(), "skill.toggle", api.AdminArgs(body), &result); err != nil {
				return err
			}
			return o.emit(cmd, result, func(w io.Writer) error {
				state := "已停用"
				if enabled {
					state = "已启用"
				}
				fmt.Fprintf(w, "%s %s\n", chat.Plain(args[0]), state)
				return nil
			})
		},
	}
	toggle.Flags().StringVar(&cwd, "cwd", "", "服务端上的项目目录，默认本机当前目录")
	root.AddCommand(toggle)
	return root
}

func (o *options) sessionExtras(root *cobra.Command) {
	root.AddCommand(&cobra.Command{
		Use: "title ID", Short: "按后续对话重新生成标题", Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client, err := o.client()
			if err != nil {
				return err
			}
			var result struct {
				Title string `json:"title"`
			}
			if err = client.Request(cmd.Context(), "POST", api.SessionPath("title", args[0]), nil, &result); err != nil {
				return err
			}
			return o.emit(cmd, result, func(w io.Writer) error {
				fmt.Fprintln(w, chat.Plain(result.Title))
				return nil
			})
		},
	})
	root.AddCommand(&cobra.Command{
		Use: "fork ID [MESSAGE_ID]", Short: "复制会话为新分支，可只保留到某条消息", Args: cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			client, err := o.client()
			if err != nil {
				return err
			}
			var body any
			if len(args) == 2 {
				body = map[string]string{"messageId": args[1]}
			}
			var result struct {
				ID string `json:"sessionId"`
			}
			if err = client.Request(cmd.Context(), "POST", api.SessionPath("fork", args[0]), body, &result); err != nil {
				return err
			}
			return o.emit(cmd, result, func(w io.Writer) error {
				fmt.Fprintln(w, result.ID)
				return nil
			})
		},
	})
	var keepFiles bool
	rollback := &cobra.Command{
		Use: "rollback ID MESSAGE_ID", Short: "回退这条消息及之后的对话，默认同时恢复文件", Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			return o.sessionMutation(cmd, "rollback", args[0], map[string]any{"messageId": args[1], "files": !keepFiles})
		},
	}
	rollback.Flags().BoolVar(&keepFiles, "keep-files", false, "只回退对话，不恢复文件")
	root.AddCommand(rollback)
	var keepToolFiles bool
	toolRollback := &cobra.Command{
		Use: "rollback-tool ID CALL_ID", Short: "只恢复某一次工具调用改过的文件", Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			client, err := o.client()
			if err != nil {
				return err
			}
			var result struct {
				Restored []string `json:"restored"`
			}
			body := map[string]any{"toolCallId": args[1], "files": !keepToolFiles}
			if err = client.Request(cmd.Context(), "POST", api.SessionPath("rollback/tool", args[0]), body, &result); err != nil {
				return err
			}
			return o.emit(cmd, result, func(w io.Writer) error {
				fmt.Fprintf(w, "已处理，涉及 %d 个文件\n", len(result.Restored))
				for _, path := range result.Restored {
					fmt.Fprintln(w, chat.Plain(path))
				}
				return nil
			})
		},
	}
	toolRollback.Flags().BoolVar(&keepToolFiles, "keep-files", false, "只丢掉这次快照，不把文件写回去")
	root.AddCommand(toolRollback)
	var keepRedoFiles bool
	redo := &cobra.Command{
		Use: "redo ID", Short: "撤销上一次回退", Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return o.sessionMutation(cmd, "redo", args[0], map[string]any{"files": !keepRedoFiles})
		},
	}
	redo.Flags().BoolVar(&keepRedoFiles, "keep-files", false, "只撤销对话回退，不把文件再改回去")
	root.AddCommand(redo)
}

func (o *options) sessionMutation(cmd *cobra.Command, action, id string, body map[string]any) error {
	client, err := o.client()
	if err != nil {
		return err
	}
	var result struct {
		api.Session
		Restored []string `json:"restored"`
	}
	if err = client.Request(cmd.Context(), "POST", api.SessionPath(action, id), body, &result); err != nil {
		return err
	}
	return o.emit(cmd, result, func(w io.Writer) error {
		fmt.Fprintf(w, "%s  [%s]\n恢复 %d 个文件\n", chat.Plain(result.Title), result.ID, len(result.Restored))
		return nil
	})
}

func (o *options) writeChanges(w io.Writer, files []api.FileChange) error {
	if len(files) == 0 {
		fmt.Fprintln(w, "没有文件改动")
		return nil
	}
	fmt.Fprintf(w, "%d 个文件有改动\n", len(files))
	for _, file := range files {
		diff, added, removed := render.Unified(file.Before, file.After)
		mark := ""
		if file.Added {
			mark = "新文件 "
		} else if file.Deleted {
			mark = "已删除 "
		}
		fmt.Fprintf(w, "\n%s%s  +%d -%d\n", mark, file.Path, added, removed)
		if diff != "" {
			fmt.Fprintln(w, render.Paint(render.Clip(diff, 120)))
		}
	}
	return nil
}

func mcpWhere(server api.MCPServer) string {
	if server.Definition.URL != "" {
		return server.Definition.URL
	}
	parts := append([]string{server.Definition.Command}, server.Definition.Args...)
	return strings.TrimSpace(strings.Join(parts, " "))
}

func onOff(value string) (bool, error) {
	switch strings.ToLower(value) {
	case "on", "true", "enable", "enabled", "1":
		return true, nil
	case "off", "false", "disable", "disabled", "0":
		return false, nil
	default:
		return false, fmt.Errorf("必须是 on 或 off")
	}
}

func serverCwd(flag string) (string, error) {
	if flag != "" {
		return flag, nil
	}
	return os.Getwd()
}

func oneLine(text string, max int) string {
	text = strings.Join(strings.Fields(text), " ")
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	return string(runes[:max-1]) + "…"
}

func table(w io.Writer) *tabwriter.Writer {
	return tabwriter.NewWriter(w, 0, 4, 2, ' ', 0)
}

func briefInput(raw []byte) string {
	var obj map[string]any
	if json.Unmarshal(raw, &obj) == nil {
		for _, key := range []string{"path", "command", "url", "regex", "query", "name", "description", "question"} {
			if text, ok := obj[key].(string); ok && strings.TrimSpace(text) != "" {
				return oneLine(text, 80)
			}
		}
	}
	return oneLine(string(raw), 80)
}

// extensions 是扩展的管理入口。CLI 不执行扩展代码；扩展想给命令行挂命令，
// 在自己 manifest.json 的 cli.commands 里声明「斜杠命令 → /admin 动作」，
// 这里的 list 能看到每条声明，call 按声明转发一次请求。
// 交互界面里的挂载在 internal/tui/extension.go，和这里共用一份 api.Extension。
func (o *options) extensions() *cobra.Command {
	root := &cobra.Command{Use: "extensions", Short: "查看和管理扩展"}

	list := &cobra.Command{Use: "list", Short: "列出扩展和它们给 CLI 挂的命令", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		client, err := o.client()
		if err != nil {
			return err
		}
		var state api.ExtensionState
		if err = client.Admin(cmd.Context(), "extension.list", nil, &state); err != nil {
			return err
		}
		return o.emit(cmd, state, func(w io.Writer) error {
			if len(state.Extensions) == 0 {
				fmt.Fprintln(w, "没有扩展。扩展放在项目的 extensions/ 或 ~/.agents/extensions/ 里。")
				return nil
			}
			tw := table(w)
			fmt.Fprintln(tw, "名称\t版本\t状态\t来源\t说明")
			for _, item := range state.Extensions {
				state := "未运行"
				switch {
				case item.Error != "":
					state = item.Error
				case !item.Enabled:
					state = "已关闭"
				case item.Running:
					state = "运行中"
				}
				if item.Changed {
					state += "（代码有更新，可 reload）"
				}
				source := "项目"
				if item.Source == "user" {
					source = "用户目录"
				}
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n", chat.Plain(item.Title), chat.Plain(item.Version), chat.Plain(state), source, chat.Plain(oneLine(item.Description, 50)))
			}
			if err := tw.Flush(); err != nil {
				return err
			}
			var declared []string
			for _, item := range state.Extensions {
				for _, command := range item.Cli.Commands {
					declared = append(declared, "/"+command.Name+"（"+item.Title+"）")
				}
			}
			if len(declared) > 0 {
				fmt.Fprintf(w, "\n挂到命令行的命令：%s\n", strings.Join(declared, "  "))
			}
			return nil
		})
	}}
	root.AddCommand(list)

	toggle := &cobra.Command{Use: "toggle NAME on|off", Short: "启用或停用一个扩展（关闭时依赖它的扩展一起停）", Args: cobra.ExactArgs(2), RunE: func(cmd *cobra.Command, args []string) error {
		enabled, err := onOff(args[1])
		if err != nil {
			return err
		}
		client, err := o.client()
		if err != nil {
			return err
		}
		var state api.ExtensionState
		if err = client.Admin(cmd.Context(), "extension.toggle", api.AdminArgs{"name": args[0], "enabled": enabled}, &state); err != nil {
			return err
		}
		return o.emit(cmd, state, func(w io.Writer) error {
			state := "已停用"
			if enabled {
				state = "已启用"
			}
			fmt.Fprintf(w, "%s %s\n", chat.Plain(args[0]), state)
			return nil
		})
	}}
	root.AddCommand(toggle)

	root.AddCommand(&cobra.Command{Use: "reload NAME", Short: "重新读取扩展代码并重启它（依赖它的扩展一起）", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		client, err := o.client()
		if err != nil {
			return err
		}
		var state api.ExtensionState
		if err = client.Admin(cmd.Context(), "extension.reload", api.AdminArgs{"name": args[0]}, &state); err != nil {
			return err
		}
		return o.emit(cmd, state, func(w io.Writer) error {
			fmt.Fprintf(w, "%s 已重载\n", chat.Plain(args[0]))
			return nil
		})
	}})

	// call 按声明转发：agent extensions call monitors --session ID
	// 命令名后面的剩余参数整段进声明的 input 字段；--arg 键=值 追加进请求体。
	var kv []string
	call := &cobra.Command{
		Use: "call COMMAND [参数...]", Short: "按扩展声明调用一个动作", Args: cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			sessionID, _ := cmd.Flags().GetString("session")
			client, err := o.client()
			if err != nil {
				return err
			}
			var state api.ExtensionState
			if err = client.Admin(cmd.Context(), "extension.list", nil, &state); err != nil {
				return err
			}
			command, owner := findExtensionCommand(state, name)
			if command.Op == "" {
				return fmt.Errorf("没有叫 %s 的扩展命令，agent extensions list 查看", name)
			}
			if !command.NoSession && sessionID == "" {
				return fmt.Errorf("%s 需要会话：加 --session SESSION_ID", name)
			}
			body := api.ExtensionBody(command, sessionID, strings.Join(args[1:], " "))
			for _, item := range kv {
				key, value, _ := strings.Cut(item, "=")
				body[key] = value   // --arg 写的覆盖声明里的同名固定值
			}
			var result any   // op 想返回什么就返回什么：对象、数组都能出
			if err = client.Admin(cmd.Context(), command.Op, api.AdminArgs(body), &result); err != nil {
				return err
			}
			return o.emit(cmd, result, func(w io.Writer) error {
				encoded, err := json.MarshalIndent(result, "", "  ")
				if err != nil {
					return err
				}
				fmt.Fprintf(w, "%s（%s）\n%s\n", name, chat.Plain(owner), string(encoded))
				return nil
			})
		},
	}
	call.Flags().StringArrayVar(&kv, "arg", nil, "追加进请求体，格式 键=值")
	call.Flags().String("session", "", "会话 ID，清单类命令（noSession）不用带")
	root.AddCommand(call)
	return root
}

// findExtensionCommand 在清单里找一条扩展命令；找不到时 op 为空。
func findExtensionCommand(state api.ExtensionState, name string) (api.ExtensionCommand, string) {
	for _, item := range state.Extensions {
		for _, command := range item.Cli.Commands {
			if command.Name == name {
				return command, item.Name
			}
		}
	}
	return api.ExtensionCommand{}, ""
}
