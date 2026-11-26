package tui

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/kernel4632/agent/cli/internal/api"
)

func press(code rune, mods tea.KeyMod) tea.KeyPressMsg {
	return tea.KeyPressMsg{Code: code, Mod: mods}
}

func TestStreamingReasoningCanStayCollapsed(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.Update(tea.WindowSizeMsg{Width: 60, Height: 25})
	m.Update(api.Event{Type: "reasoning-delta", Text: "思考第一段"})
	if strings.Contains(m.View().Content, "思考第一段") {
		t.Fatal("reasoning should start collapsed")
	}
	m.Update(press('r', tea.ModCtrl))
	if !strings.Contains(m.View().Content, "思考第一段") {
		t.Fatal("reasoning did not expand")
	}
	m.Update(press('r', tea.ModCtrl))
	m.Update(api.Event{Type: "reasoning-delta", Text: "思考第二段"})
	if strings.Contains(m.View().Content, "思考第二段") {
		t.Fatal("stream forced reasoning open")
	}
	m.Update(api.Event{Type: "text-delta", Text: "正文"})
	if !strings.Contains(m.View().Content, "正文") {
		t.Fatal("answer missing")
	}
}

func TestCompactionDeltasAreNotRenderedAsAssistantAnswers(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.event(api.Event{Type: "text-delta", Request: json.RawMessage(`"compact"`), Text: "内部总结"})
	m.event(api.Event{Type: "reasoning-delta", Request: json.RawMessage(`"compact"`), Text: "内部推理"})
	if m.liveText != "" || m.liveReasoning != "" {
		t.Fatal("compaction content leaked into the answer")
	}
	m.event(api.Event{Type: "text-delta", Text: "用户回答"})
	if m.liveText != "用户回答" {
		t.Fatalf("answer was lost: %q", m.liveText)
	}
}

func TestApprovalKeyboardControlsRealRequestAndFinishesRun(t *testing.T) {
	for _, choice := range []struct {
		key      rune
		decision string
	}{{'y', "allow"}, {'n', "deny"}} {
		t.Run(choice.decision, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			decided := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/sse/connect/s":
					w.Header().Set("Content-Type", "text/event-stream")
					w.(http.Flusher).Flush()
					select {
					case <-decided:
					case <-r.Context().Done():
						return
					}
					fmt.Fprint(w, "data: {\"type\":\"agent-finish\"}\n\n")
				case "/agent/decide/s":
					var body map[string]string
					_ = json.NewDecoder(r.Body).Decode(&body)
					if body["toolCallId"] != "c" || body["decision"] != choice.decision {
						t.Errorf("wrong decision: %v", body)
					}
					close(decided)
					fmt.Fprint(w, `{"ok":true}`)
				case "/session/read/s":
					fmt.Fprint(w, `{"id":"s","running":false,"history":[{"role":"assistant","content":"saved answer"}]}`)
				}
			}))
			defer server.Close()
			client, _ := api.New(server.URL)
			m := newModel(ctx, client, api.Session{ID: "s", Running: true, Pending: []api.Permission{{CallID: "c", Tool: "read_file"}}})
			worker := m.begin("watch", "")
			go worker()
			for {
				select {
				case <-ctx.Done():
					t.Fatal("UI did not finish")
				case msg := <-m.updates:
					m.Update(msg)
					if _, ok := msg.(permissionMsg); ok {
						if !strings.Contains(m.View().Content, "read_file") {
							t.Error("approval input hidden")
						}
						m.Update(press(choice.key, 0))
					}
					if _, ok := msg.(doneMsg); ok {
						if m.running || m.permission != nil || !strings.Contains(m.View().Content, "saved answer") {
							t.Fatal("UI did not settle on saved history")
						}
						<-m.runDone
						return
					}
				}
			}
		})
	}
}

func TestStopKeysDoNotQuitBeforeRunStops(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	ctx, cancel := context.WithCancel(context.Background())
	m.running, m.cancel = true, cancel
	m.permission = &permissionMsg{permission: api.Permission{CallID: "c"}, reply: make(chan string, 1)}
	_, cmd := m.Update(press('c', tea.ModCtrl))
	if ctx.Err() == nil || cmd != nil || m.quitting {
		t.Fatal("Ctrl+C must cancel and wait, preserving the chat")
	}
	m.Update(press('q', tea.ModCtrl))
	if !m.quitting {
		t.Fatal("Ctrl+Q must quit after cancellation")
	}
	_, cmd = m.Update(doneMsg{session: api.Session{ID: "s"}, err: context.Canceled})
	if cmd == nil {
		t.Fatal("stopped UI did not quit")
	}
}

func TestCommandPanelShowsAllSessionsAndHelp(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 30})
	m.Update(commandMsg{text: "first-session\nsecond-session"})
	if !strings.Contains(m.View().Content, "second-session") {
		t.Fatal("session list was truncated to one line")
	}
	m.slash("/help")
	help := m.View().Content
	if strings.Contains(m.panel, "/open") || strings.Contains(help, "second-session") {
		t.Fatal("help was written into the transcript")
	}
	if !strings.Contains(help, "/open") || !strings.Contains(help, "/reasoning") || !strings.Contains(help, "esc 关闭") {
		t.Fatal(help)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEsc})
	if !strings.Contains(m.View().Content, "second-session") {
		t.Fatal("closing help lost the earlier result")
	}
}

func TestQuotedModelSelectionUsesExactNames(t *testing.T) {
	var requests []map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PATCH" {
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			requests = append(requests, body)
		}
		fmt.Fprint(w, `{"id":"s"}`)
	}))
	defer server.Close()
	client, _ := api.New(server.URL)
	for _, argument := range []string{`"provider with spaces" second`, `'provider with spaces' second`, `"中文 供应商" "model with spaces"`} {
		if _, _, err := execute(context.Background(), client, api.Session{ID: "s"}, "/model", argument); err != nil {
			t.Fatal(err)
		}
	}
	if requests[0]["provider"] != "provider with spaces" || requests[1]["provider"] != requests[0]["provider"] || requests[2]["model"] != "model with spaces" {
		t.Fatalf("wrong model selections: %v", requests)
	}
	for _, argument := range []string{`"unfinished second`, `"" second`, `provider`, `one two three`} {
		if _, _, err := execute(context.Background(), client, api.Session{ID: "s"}, "/model", argument); err == nil {
			t.Errorf("accepted invalid argument %q", argument)
		}
	}
	if len(requests) != 3 {
		t.Fatal("invalid input made an HTTP mutation")
	}
}

func TestClosingHelpReturnsToTheLatestLine(t *testing.T) {
	history := make([]api.Message, 0, 30)
	for i := range 30 {
		raw, _ := json.Marshal("line-" + itoa(i))
		history = append(history, api.Message{Role: "user", MessageID: "m" + itoa(i), Content: raw})
	}
	m := newModel(context.Background(), nil, api.Session{ID: "s", History: history})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 16})
	bottom := m.viewport.YOffset()
	if !m.viewport.AtBottom() || bottom < 8 {
		t.Fatalf("not following the latest line: %d", bottom)
	}
	m.openHelp()
	m.viewport.GotoTop()
	m.Update(tea.KeyPressMsg{Code: tea.KeyEsc})
	view := m.View().Content
	if m.overlay.kind != "" || !m.viewport.AtBottom() || m.viewport.YOffset() != bottom {
		t.Fatalf("stuck at %d overlay %q", m.viewport.YOffset(), m.overlay.kind)
	}
	if strings.Contains(view, "用命令名或中文说明筛选") || !strings.Contains(view, "line-29") {
		t.Fatalf("help stayed over the conversation:\n%s", view)
	}
}

func TestComingBackRepaintsAndReadsTheSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/session/read/s" {
			t.Errorf("unexpected %s", r.URL.Path)
			w.WriteHeader(500)
			return
		}
		fmt.Fprint(w, `{"id":"s","running":true,"history":[{"role":"assistant","content":"后来的回答"}]}`)
	}))
	defer server.Close()
	client, _ := api.New(server.URL)
	m := newModel(context.Background(), client, api.Session{ID: "s"})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	if _, cmd := m.Update(tea.FocusMsg{}); cmd != nil || m.paint != 0 {
		t.Fatal("startup focus looked like a return")
	}
	m.Update(tea.BlurMsg{})
	_, cmd := m.Update(tea.FocusMsg{})
	if m.paint == 0 || !strings.Contains(m.View().Content, "\u200b") {
		t.Fatal("return did not force a redraw")
	}
	var caught tea.Msg
	switch got := cmd().(type) {
	case catchMsg:
		caught = got
	case tea.BatchMsg:
		for _, item := range got {
			if item == nil {
				continue
			}
			if next, ok := item().(catchMsg); ok {
				caught = next
			}
		}
	}
	if caught == nil {
		t.Fatal("return did not read the session")
	}
	if _, cmd = m.Update(caught); !m.running || cmd == nil {
		t.Fatal("a run that started elsewhere was not reattached")
	}
	if !strings.Contains(m.View().Content, "后来的回答") {
		t.Fatalf("history was not shown:\n%s", m.View().Content)
	}
}

func TestExtensionMountCommandShortcutTopbarAndUnload(t *testing.T) {
	var received []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin" {
			w.WriteHeader(404)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		received = append(received, body)
		switch body["op"] {
		case "monitor.list":
			fmt.Fprint(w, `{"monitors":[{"id":"m1","status":"armed","rounds":"0/5","name":"构建","summary":"定时 10s","objective":"验证"}]}`)
		case "monitor.stop":
			fmt.Fprint(w, `["m1"]`)
		default:
			w.WriteHeader(400)
			fmt.Fprint(w, `{"error":"bad op"}`)
		}
	}))
	defer server.Close()
	client, _ := api.New(server.URL)

	todoRaw := json.RawMessage(`{"type":"json","value":{"items":[{"text":"第一项","status":"completed"},{"text":"修扩展","status":"in_progress"}]}}`)
	todoHist, _ := json.Marshal([]api.Part{{Type: "tool-result", ToolName: "update_todo_list", ToolCallID: "t1", Output: todoRaw}})
	m := newModel(context.Background(), client, api.Session{
		ID: "s1", Cwd: "/work",
		History: []api.Message{{Role: "tool", MessageID: "m1", Content: todoHist}},
	})
	m.Update(tea.WindowSizeMsg{Width: 90, Height: 28})

	state := api.ExtensionState{
		Extensions: []api.Extension{
			{
				Name: "monitor", Title: "监控唤醒", Enabled: true, Running: true,
				Cli: api.ExtensionCli{Commands: []api.ExtensionCommand{
					{Name: "monitors", Hint: "查看后台监控", Usage: "[会话 ID]", Op: "monitor.list", Params: []string{"sessionId"},
						View: &api.ExtensionView{Kind: "list", Title: "后台监控", Items: "monitors", Fields: []api.ExtensionViewField{{Key: "id", Label: "编号"}, {Key: "status", Label: "状态"}}}},
					{Name: "monitor-stop", Hint: "停掉后台监控", Usage: "编号|all [会话 ID]", Op: "monitor.stop", Params: []string{"id", "sessionId"}},
					{Name: "help", Hint: "冲突命令", Op: "bad.help"},
				}},
			},
			{
				Name: "todo", Title: "任务清单", Enabled: true, Running: true,
				Cli: api.ExtensionCli{
					Topbar: []api.ExtensionTopbar{{
						ID: "todo", Tool: "update_todo_list", Items: "items", Label: "任务",
						Count:   &api.ExtensionTopbarCount{Field: "status", Equals: "completed"},
						Current: &api.ExtensionTopbarCurrent{Field: "status", Equals: "in_progress", Text: "text"},
					}},
					Commands: []api.ExtensionCommand{{
						Name: "todos", Hint: "打开任务清单", Shortcut: "ctrl+t", Tool: "update_todo_list",
						View: &api.ExtensionView{Kind: "checklist", Title: "任务清单", Progress: "进度", Items: "items", Text: "text", Status: "status"},
					}},
				},
			},
		},
	}

	m.mountExtensions(state)
	// 冲突的内置命令名不准劫持 /help
	if _, hijacked := m.findExtCommand("/help"); hijacked {
		t.Fatal("extension hijacked built-in /help")
	}
	// allSlashCommands 不污染包级 slashCommands
	_ = m.allSlashCommands()
	for _, cmd := range slashCommands {
		if cmd.Name == "/monitors" {
			t.Fatal("package-level slashCommands mutated")
		}
	}

	// 顶栏自动出现扩展挂载的任务状态条
	if !strings.Contains(m.View().Content, "任务 1/2 · 修扩展") {
		t.Fatalf("extension topbar missing:\n%s", m.View().Content)
	}
	// 中文 hint 搜索能匹配挂载命令，且无必选参数的 /monitors 回车直接执行
	m.input.Focus()
	m.input.SetValue("/后台监控")
	if !strings.Contains(m.View().Content, "/monitors") {
		t.Fatalf("chinese hint missed extension command:\n%s", m.View().Content)
	}
	_, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("/monitors should execute directly on Enter")
	}
	m.Update(cmd())
	if m.overlay.kind != "ext" || !strings.Contains(m.View().Content, "后台监控") || !strings.Contains(m.View().Content, "m1") {
		t.Fatalf("monitor overlay failed: kind=%q\n%s", m.overlay.kind, m.View().Content)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyEsc})

	// 必须参数命令 /monitor-stop 回车先补全，带参数提交则按 params 发出 id
	m.input.SetValue("/monitor-stop")
	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.input.Value() != "/monitor-stop " {
		t.Fatalf("required arg command did not complete: %q", m.input.Value())
	}
	m.input.SetValue("/monitor-stop m1")
	_, cmd = m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	m.Update(cmd())
	if last := received[len(received)-1]; last["op"] != "monitor.stop" || last["id"] != "m1" || last["sessionId"] != "s1" {
		t.Fatalf("unexpected monitor.stop request: %#v", last)
	}

	// Ctrl+T 触发 todo 扩展的 checklist 浮层，此时顶栏状态自动让位隐藏
	m.Update(press('t', tea.ModCtrl))
	if m.overlay.kind != "ext" || !strings.Contains(m.View().Content, "进度 1/2") || !strings.Contains(m.View().Content, "▸ 修扩展") {
		t.Fatalf("ctrl+t overlay failed: kind=%q\n%s", m.overlay.kind, m.View().Content)
	}
	if strings.Contains(m.View().Content, "任务 1/2 · 修扩展") {
		t.Fatal("topbar did not hide while its own overlay is open")
	}

	// 停用 todo 后整表重建：浮层关闭、顶栏状态消失、/todos 和 Ctrl+T 撤除
	state.Extensions[1].Running = false
	state.Extensions[1].Enabled = false
	m.mountExtensions(state)
	if m.overlay.kind != "" || len(m.extTopbarLines()) != 0 {
		t.Fatalf("disabled extension left overlay=%q topbars=%d", m.overlay.kind, len(m.extTopbarLines()))
	}
	if _, ok := m.findExtCommand("/todos"); ok {
		t.Fatal("/todos survived extension disable")
	}
	if _, handled := m.globalKey("ctrl+t"); handled {
		t.Fatal("ctrl+t survived extension disable")
	}

	// 空 client 时执行扩展命令不崩溃、不卡 busy，错误走 notice 不覆写 panel
	m.panel = "keep-panel"
	offline := newModel(context.Background(), nil, api.Session{ID: "s1"})
	offline.panel = "keep-panel"
	offline.mountExtensions(api.ExtensionState{Extensions: state.Extensions[:1]})
	if c := offline.runExtensionCommand(state.Extensions[0].Cli.Commands[0], ""); c != nil || offline.busy || offline.panel != "keep-panel" || offline.notice == "" {
		t.Fatalf("offline runExtensionCommand misbehaved: busy=%v panel=%q notice=%q", offline.busy, offline.panel, offline.notice)
	}
	// 切换会话（adopt）清空旧会话工具缓存
	m.adopt(api.Session{ID: "s2"})
	if len(m.toolOutputs) != 0 {
		t.Fatalf("stale toolOutputs leaked across session switch: %#v", m.toolOutputs)
	}
}
