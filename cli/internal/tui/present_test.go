package tui

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/kernel4632/agent/cli/internal/api"
)

func TestToolRowUsesSummaryInsteadOfRawInput(t *testing.T) {
	content, err := json.Marshal([]api.Part{{
		Type: "tool-call", ToolName: "read_file", ToolCallID: "c",
		Input: json.RawMessage(`{"path":"main.go","extra":"SHOULD_NOT_SHOW"}`),
	}})
	if err != nil {
		t.Fatal(err)
	}
	m := newModel(context.Background(), nil, api.Session{ID: "s", History: []api.Message{{
		Role: "assistant", MessageID: "m", Content: content,
	}}})
	m.tools = map[string]api.Tool{"read_file": {Name: "read_file", UI: struct {
		Title   string `json:"title"`
		Summary string `json:"summary"`
		Icon    string `json:"icon"`
	}{Title: "读取文件", Summary: "{path}"}}}
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 30})
	view := m.View().Content
	if !strings.Contains(view, "读取文件") || !strings.Contains(view, "main.go") {
		t.Fatalf("summary missing: %s", view)
	}
	if strings.Contains(view, "SHOULD_NOT_SHOW") {
		t.Fatalf("raw input leaked: %s", view)
	}
}

func TestUsageStaysOnTheStatusLine(t *testing.T) {
	text, _ := json.Marshal("hello")
	usage, _ := json.Marshal(map[string]int{"input": 9, "output": 8, "cacheRead": 7})
	m := newModel(context.Background(), nil, api.Session{
		ID: "s", Provider: "p", Model: "q",
		History: []api.Message{{Role: "assistant", Content: text, Usage: usage}},
	})
	m.config.Providers = []struct {
		Name    string `json:"name"`
		Enabled *bool  `json:"enabled"`
		Models  []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Context int    `json:"context"`
		} `json:"models"`
	}{{
		Name: "p",
		Models: []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Context int    `json:"context"`
		}{{ID: "q", Context: 100}},
	}}
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 30})
	view := m.View().Content
	if !strings.Contains(view, "hello") || !strings.Contains(view, "入 9") || !strings.Contains(view, "上下文 9%") {
		t.Fatalf("stats missing: %s", view)
	}
	if strings.Contains(view, "缓存 7 tokens") {
		t.Fatalf("usage was dumped into the transcript: %s", view)
	}
}

func TestFinishedToolCollapsesUntilOpened(t *testing.T) {
	input := json.RawMessage(`{"command":"echo hi"}`)
	output := json.RawMessage(`{"type":"text","value":"hello from tool"}`)
	call, _ := json.Marshal([]api.Part{{Type: "tool-call", ToolName: "execute_command", ToolCallID: "c", Input: input}})
	result, _ := json.Marshal([]api.Part{{Type: "tool-result", ToolCallID: "c", ToolName: "execute_command", Output: output}})
	m := newModel(context.Background(), nil, api.Session{ID: "s", History: []api.Message{
		{Role: "assistant", MessageID: "a", Content: call},
		{Role: "tool", MessageID: "r", Content: result},
	}})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	view := m.View().Content
	if strings.Contains(view, "hello from tool") {
		t.Fatalf("finished tool stayed open:\n%s", view)
	}
	if !strings.Contains(view, "▸") || !strings.Contains(view, "echo hi") {
		t.Fatalf("collapsed row missing:\n%s", view)
	}
	m.focus = focusTranscript
	m.rebuild()
	for i, item := range m.blocks {
		if item.kind == "tool" {
			m.selected = i
			m.selectedID = item.id
		}
	}
	if !strings.Contains(m.copyText(), "echo hi") || !strings.Contains(m.copyText(), "hello from tool") {
		t.Fatalf("copy %q", m.copyText())
	}
	if _, handled := m.handleKey(tea.KeyPressMsg{Code: tea.KeyEnter}); !handled {
		t.Fatal("enter did not toggle the tool")
	}
	opened := m.View().Content
	if !strings.Contains(opened, "hello from tool") || !strings.Contains(opened, "▾") {
		t.Fatalf("tool did not expand:\n%s", opened)
	}
	m.open[m.selectedID] = false
	m.renderConversation(false)
	collapsed := m.View().Content
	if strings.Contains(collapsed, "hello from tool") {
		t.Fatalf("tool did not collapse again:\n%s", collapsed)
	}
	var row blockSpan
	found := false
	for _, span := range m.spans {
		if span.index < len(m.blocks) && m.blocks[span.index].kind == "tool" {
			row = span
			found = true
		}
	}
	if !found {
		t.Fatal("no tool span")
	}
	y := m.frameTop + row.start - m.viewport.YOffset()
	m.Update(tea.MouseClickMsg{X: 2, Y: y, Button: tea.MouseLeft})
	if !strings.Contains(m.View().Content, "hello from tool") {
		t.Fatalf("click did not expand y=%d top=%d offset=%d\n%s", y, m.frameTop, m.viewport.YOffset(), m.View().Content)
	}
}

func TestRunningToolStaysCollapsed(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	tool := &liveTool{id: "c", name: "execute_command", input: json.RawMessage(`{"command":"echo hi"}`), running: true}
	tool.stream.WriteString("still running")
	m.steps = []liveStep{{kind: "tool", tool: tool}}
	m.running = true
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	view := m.View().Content
	if strings.Contains(view, "still running") || strings.Contains(view, "▾") {
		t.Fatalf("running tool output filled the screen:\n%s", view)
	}
	if !strings.Contains(view, "▸") || !strings.Contains(view, "echo hi") {
		t.Fatalf("collapsed row missing:\n%s", view)
	}
}

func TestToolRunsCollapseToOneLine(t *testing.T) {
	var history []api.Message
	user, _ := json.Marshal("看一下这三个文件")
	history = append(history, api.Message{Role: "user", MessageID: "u", Content: user})
	var parts []api.Part
	for i, path := range []string{"a.go", "b.go", "c.go"} {
		parts = append(parts, api.Part{
			Type: "tool-call", ToolName: "read_file", ToolCallID: "c" + itoa(i),
			Input: json.RawMessage(`{"path":"` + path + `"}`),
		})
	}
	call, _ := json.Marshal(parts)
	history = append(history, api.Message{Role: "assistant", MessageID: "a", Content: call})
	for i, path := range []string{"a.go", "b.go", "c.go"} {
		result, _ := json.Marshal([]api.Part{{
			Type: "tool-result", ToolCallID: "c" + itoa(i), ToolName: "read_file",
			Output: json.RawMessage(`{"type":"text","value":"SECRET ` + path + `"}`),
		}})
		history = append(history, api.Message{Role: "tool", MessageID: "r" + itoa(i), Content: result})
	}
	answer, _ := json.Marshal("三个文件都读完了")
	history = append(history, api.Message{Role: "assistant", MessageID: "z", Content: answer})
	m := newModel(context.Background(), nil, api.Session{ID: "s", History: history})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	view := m.View().Content
	if !strings.Contains(view, "三个文件都读完了") || !strings.Contains(view, "工具 3") {
		t.Fatalf("answer or summary missing:\n%s", view)
	}
	if strings.Contains(view, "SECRET") || strings.Contains(view, "a.go") {
		t.Fatalf("tool output stayed on screen:\n%s", view)
	}
	m.focus = focusTranscript
	for i, item := range m.blocks {
		if item.kind == "tool" {
			m.selected = i
			m.selectedID = item.id
			break
		}
	}
	if _, handled := m.handleKey(tea.KeyPressMsg{Code: tea.KeyEnter}); !handled {
		t.Fatal("enter did not expand the tool run")
	}
	opened := m.View().Content
	if !strings.Contains(opened, "a.go") || !strings.Contains(opened, "c.go") || strings.Contains(opened, "SECRET") {
		t.Fatalf("list did not open without the output:\n%s", opened)
	}
}

func TestUsagePanelShowsSpeedAndBreakdown(t *testing.T) {
	text, _ := json.Marshal("hello")
	usage, _ := json.Marshal(map[string]any{
		"input": 1000, "output": 250, "cacheRead": 800, "reasoning": 20,
		"durationMs": 5000, "firstTokenMs": 1000, "provider": "p", "model": "q",
	})
	m := newModel(context.Background(), nil, api.Session{
		ID: "s", Provider: "p", Model: "q",
		History: []api.Message{{Role: "assistant", Content: text, Usage: usage}},
	})
	m.config.Providers = []struct {
		Name    string `json:"name"`
		Enabled *bool  `json:"enabled"`
		Models  []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Context int    `json:"context"`
		} `json:"models"`
	}{{Name: "p", Models: []struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Context int    `json:"context"`
	}{{ID: "q", Context: 10000}}}}
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 40})
	bar := m.View().Content
	if !strings.Contains(bar, "63 tok/s") {
		t.Fatalf("speed missing:\n%s", bar)
	}
	m.Update(tea.KeyPressMsg{Code: 'u', Mod: tea.ModCtrl})
	panel := m.View().Content
	for _, want := range []string{"上下文", "缓存命中 80%", "未缓存输入 200", "思考 20", "63 tok/s", "p/q"} {
		if !strings.Contains(panel, want) {
			t.Fatalf("panel missing %q:\n%s", want, panel)
		}
	}
	m.closeOverlay()
	m.View()
	if _, cmd := m.Update(tea.MouseClickMsg{X: 1, Y: m.height - 1, Button: tea.MouseLeft}); cmd != nil || m.overlay.kind != "stats" {
		t.Fatalf("footer click did not open stats: %q", m.overlay.kind)
	}
}

// stripAnsi 去掉配色，只留文字，测试才能直接比对界面的字符。
func stripAnsi(text string) string {
	return regexp.MustCompile("\x1b\\[[0-9;]*m").ReplaceAllString(text, "")
}

func TestInputIsASinglePrompt(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	got := m.input.View()
	if m.input.Height() != 1 || strings.Count(got, "> ") != 1 {
		t.Fatalf("height %d\n%s", m.input.Height(), got)
	}
	if strings.Contains(got, "›") || strings.Contains(got, "┃") || !strings.Contains(got, "查看命令") {
		t.Fatal(got)
	}
}

func TestComposerDrawsSplitBorder(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	m.input.Focus()
	frame := m.View()
	lines := strings.Split(frame.Content, "\n")
	row := stripAnsi(lines[len(lines)-2])
	if !strings.HasPrefix(row, "┃ ") || !strings.HasSuffix(row, " ┃") {
		t.Fatalf("input row is not framed: %q", row)
	}
	if lipgloss.Width(row) != 78 {
		t.Fatalf("input row width %d, want 78", lipgloss.Width(row))
	}
	if frame.Cursor == nil || frame.Cursor.Y != len(lines)-2 || frame.Cursor.X < 2 {
		t.Fatalf("cursor %+v not inside the border", frame.Cursor)
	}

	m.Update(tea.WindowSizeMsg{Width: 20, Height: 24})
	narrow := strings.Split(m.View().Content, "\n")
	if row := stripAnsi(narrow[len(narrow)-2]); strings.HasPrefix(row, "┃") {
		t.Fatalf("narrow terminal kept the border: %q", row)
	}
}

func TestCursorStaysOnTheInputLine(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	m.input.Focus()
	m.input.SetValue("你好")
	view := m.View()
	if view.Cursor == nil {
		t.Fatal("real cursor is hidden")
	}
	lines := strings.Split(view.Content, "\n")
	if view.Cursor.Y < 0 || view.Cursor.Y >= len(lines) {
		t.Fatalf("cursor y %d of %d", view.Cursor.Y, len(lines))
	}
	line := lines[view.Cursor.Y]
	if !strings.Contains(line, "> ") || !strings.Contains(line, "你好") || strings.Contains(line, "ctrl+") {
		t.Fatalf("cursor x=%d y=%d line %q", view.Cursor.X, view.Cursor.Y, line)
	}
	if view.Cursor.Y != len(lines)-2 || !strings.Contains(lines[len(lines)-1], "ctrl+") {
		t.Fatalf("cursor y=%d last %q", view.Cursor.Y, lines[len(lines)-1])
	}
	if view.Cursor.X != 8 {
		t.Fatalf("cursor x=%d, want the cell after 你好 behind the input border", view.Cursor.X)
	}
}

func TestSlashMenuCompletesAndExplains(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	m.input.SetValue("/mo")
	view := m.View().Content
	if !strings.Contains(view, "/model") || !strings.Contains(view, "切换模型") || strings.Contains(view, "/sessions") {
		t.Fatal(view)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if m.input.Value() != "/model " {
		t.Fatalf("tab completed %q", m.input.Value())
	}
	if hint := m.View().Content; !strings.Contains(hint, "供应商 模型") {
		t.Fatal(hint)
	}
	m.input.SetValue("/op")
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || m.input.Value() != "/open " {
		t.Fatalf("enter should wait for an id, value %q cmd %v", m.input.Value(), cmd != nil)
	}
}

func TestSlashMenuMatchesChineseHint(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	m.input.Focus()
	m.input.SetValue("/用量")
	view := m.View().Content
	if !strings.Contains(view, "/usage") || strings.Contains(view, "/sessions") {
		t.Fatalf("chinese hint missed:\n%s", view)
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || m.overlay.kind != "stats" {
		t.Fatalf("enter did not run the hinted command: %q", m.overlay.kind)
	}
	m.closeOverlay()
	m.input.Focus()
	m.input.SetValue("/回退")
	view = m.View().Content
	rollback := strings.Index(view, "/rollback")
	redo := strings.Index(view, "/redo")
	if rollback < 0 || redo < 0 || rollback > redo {
		t.Fatalf("rollback order:\n%s", view)
	}
}

func TestFrameKeepsMultilineInputOnScreen(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.Update(tea.WindowSizeMsg{Width: 40, Height: 16})
	m.input.Focus()
	m.input.SetValue("一\n二\n三\n四")
	view := m.View()
	lines := strings.Split(view.Content, "\n")
	if len(lines) != 16 {
		t.Fatalf("frame height %d\n%s", len(lines), view.Content)
	}
	if !strings.Contains(view.Content, "一") || !strings.Contains(view.Content, "四") {
		t.Fatalf("input clipped:\n%s", view.Content)
	}
	if !strings.Contains(lines[len(lines)-1], "enter") && !strings.Contains(lines[len(lines)-1], "ctrl") {
		t.Fatalf("footer left the screen: %q", lines[len(lines)-1])
	}
	if view.Cursor == nil || view.Cursor.Y != len(lines)-2 {
		t.Fatalf("cursor %+v not on the last input line", view.Cursor)
	}
}

func TestHistoryScrollsByPageAndWheel(t *testing.T) {
	history := make([]api.Message, 0, 40)
	for i := range 40 {
		raw, _ := json.Marshal("scroll-line-" + strings.Repeat("x", i) + "-" + string(rune('a'+i%26)))
		history = append(history, api.Message{Role: "user", MessageID: "m", Content: raw})
	}
	// Distinct text so the bottom and the previous page cannot look the same.
	for i := range history {
		raw, _ := json.Marshal("scroll-line-" + strings.Repeat("0", 2) + "-" + itoa(i))
		history[i].Content = raw
		history[i].MessageID = "m" + itoa(i)
	}
	m := newModel(context.Background(), nil, api.Session{ID: "s", History: history})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 18})
	m.input.Focus()
	before := m.View().Content
	bottom := m.viewport.YOffset()
	if bottom < 8 {
		t.Fatalf("history was not scrollable, offset %d", bottom)
	}
	if _, handled := m.handleKey(tea.KeyPressMsg{Code: tea.KeyPgUp}); !handled {
		t.Fatal("pgup was not handled")
	}
	after := m.View().Content
	if m.viewport.YOffset() >= bottom || after == before {
		t.Fatalf("pgup offset %d -> %d", bottom, m.viewport.YOffset())
	}
	paged := m.viewport.YOffset()
	m.Update(tea.MouseWheelMsg{Button: tea.MouseWheelUp})
	_ = m.View()
	if m.viewport.YOffset() >= paged {
		t.Fatalf("wheel did not scroll, offset %d", m.viewport.YOffset())
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	_ = m.View()
	if m.viewport.YOffset() <= paged-3 {
		t.Fatalf("down arrow did not move back toward the latest lines, offset %d", m.viewport.YOffset())
	}
}

func TestQuestionAndCommandStayAboveTheInput(t *testing.T) {
	input, _ := json.Marshal(map[string]string{"question": "要改哪个文件？\n请给路径"})
	content, _ := json.Marshal([]api.Part{{
		Type: "tool-call", ToolName: "ask_followup_question", ToolCallID: "q", Input: input,
	}})
	m := newModel(context.Background(), nil, api.Session{ID: "s", History: []api.Message{{
		Role: "assistant", MessageID: "a", Content: content,
	}}})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 20})
	m.input.Focus()
	view := m.View()
	lines := strings.Split(view.Content, "\n")
	if len(lines) != 20 {
		t.Fatalf("frame height %d", len(lines))
	}
	if !strings.Contains(view.Content, "需要你回答") || !strings.Contains(view.Content, "要改哪个文件？") || !strings.Contains(view.Content, "请给路径") {
		t.Fatalf("question not pinned:\n%s", view.Content)
	}
	if !strings.Contains(m.input.Placeholder, "回答") {
		t.Fatalf("placeholder %q", m.input.Placeholder)
	}

	command, _ := json.Marshal(map[string]string{"command": "echo one\necho two", "cwd": "/tmp/work"})
	m.permission = &permissionMsg{permission: api.Permission{CallID: "c", Tool: "execute_command", Input: command}, reply: make(chan string, 1)}
	view = m.View()
	lines = strings.Split(view.Content, "\n")
	if len(lines) != 20 {
		t.Fatalf("confirm frame height %d\n%s", len(lines), view.Content)
	}
	if !strings.Contains(view.Content, "确认执行命令") || !strings.Contains(view.Content, "echo one") || !strings.Contains(view.Content, "echo two") || !strings.Contains(view.Content, "/tmp/work") {
		t.Fatalf("command confirm missing:\n%s", view.Content)
	}
	if strings.Contains(view.Content, "echo one echo two") {
		t.Fatalf("multiline command was flattened:\n%s", view.Content)
	}
	if !strings.Contains(view.Content, "y 允许") {
		t.Fatalf("confirm keys missing:\n%s", view.Content)
	}
}

func TestInlineChoicesBecomeAMenu(t *testing.T) {
	const question = "你希望我接下来用哪个方向来处理这个项目（当前目录看起来是一个带 server.js / tools / features 的服务端项目）？比如：1) 读 README 和 server.js，给我一份架构与接口梳理；2) 跑一遍测试（tests/ 目录）并修复失败的用例；3) 检查 openapi.json 与实现是否一致；4) 其他你指定的任务。"
	stem, choices := parseChoices(question)
	if len(choices) != 4 {
		t.Fatalf("choices %d %#v", len(choices), choices)
	}
	if !strings.Contains(stem, "哪个方向") || strings.Contains(stem, "比如") || strings.Contains(stem, "1)") {
		t.Fatalf("stem %q", stem)
	}
	if choices[0].text != "读 README 和 server.js，给我一份架构与接口梳理" || choices[0].free {
		t.Fatalf("first %#v", choices[0])
	}
	if choices[1].text != "跑一遍测试（tests/ 目录）并修复失败的用例" {
		t.Fatalf("second %q", choices[1].text)
	}
	if !choices[3].free {
		t.Fatal("custom option should wait for typed text")
	}
	if _, got := parseChoices("注意：1) 只有这一项"); len(got) != 0 {
		t.Fatalf("single marker became a menu: %#v", got)
	}
	if _, got := parseChoices("版本：1. 26 发布了"); len(got) != 0 {
		t.Fatalf("version became a menu: %#v", got)
	}
	listed, list := parseChoices("请选择：\n1. 读 README\n2. 跑测试\n3. 检查接口")
	if len(list) != 3 || !strings.Contains(listed, "请选择") || list[2].text != "检查接口" {
		t.Fatalf("newline list stem %q choices %#v", listed, list)
	}

	m := questionModel(t, question)
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	m.input.Focus()
	frame := m.View()
	view := frame.Content
	lines := strings.Split(view, "\n")
	if frame.Cursor == nil || frame.Cursor.Y < 0 || frame.Cursor.Y >= len(lines) || !strings.Contains(lines[frame.Cursor.Y], "也可直接输入") {
		got := ""
		if frame.Cursor != nil && frame.Cursor.Y >= 0 && frame.Cursor.Y < len(lines) {
			got = lines[frame.Cursor.Y]
		}
		t.Fatalf("cursor %+v not on the answer line %q", frame.Cursor, got)
	}
	if strings.Index(view, "哪个方向") > strings.Index(view, "> 1  读") {
		t.Fatalf("question stem fell below the choices:\n%s", view)
	}
	if strings.Contains(view, "1)") || strings.Contains(view, "；2)") || strings.Contains(view, "比如") {
		t.Fatalf("options still prose:\n%s", view)
	}
	if !strings.Contains(view, "> 1  读 README") || !strings.Contains(view, "  2  跑一遍测试") || !strings.Contains(view, "openapi.json") || !strings.Contains(view, "其他你指定的任务") {
		t.Fatalf("menu missing:\n%s", view)
	}
	if !strings.Contains(m.input.Placeholder, "数字") {
		t.Fatalf("placeholder %q", m.input.Placeholder)
	}
	if _, handled := m.handleKey(tea.KeyPressMsg{Code: tea.KeyDown}); !handled {
		t.Fatal("down was not a choice move")
	}
	moved := m.View().Content
	if !strings.Contains(moved, "> 2  跑一遍测试") || strings.Contains(moved, "> 1  ") {
		t.Fatalf("selection did not move:\n%s", moved)
	}
	if _, handled := m.handleKey(tea.KeyPressMsg{Code: tea.KeyEnter}); !handled {
		t.Fatal("enter did not confirm")
	}
	if got := lastUserText(t, m); got != choices[1].text {
		t.Fatalf("sent %q", got)
	}

	m = questionModel(t, question)
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	m.input.Focus()
	if _, handled := m.handleKey(tea.KeyPressMsg{Code: '1'}); !handled {
		t.Fatal("1 was not handled")
	}
	if got := lastUserText(t, m); got != choices[0].text {
		t.Fatalf("digit sent %q", got)
	}

	m = questionModel(t, question)
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	m.input.Focus()
	if _, handled := m.handleKey(tea.KeyPressMsg{Code: '4'}); !handled {
		t.Fatal("4 was not handled")
	}
	if len(m.session.History) != 1 {
		t.Fatal("free choice was sent")
	}
	picked := m.View()
	if !strings.Contains(picked.Content, "> 4  其他") {
		t.Fatalf("free choice not selected:\n%s", picked.Content)
	}
	if !strings.Contains(m.input.Placeholder, "输入你的回答") {
		t.Fatalf("placeholder %q", m.input.Placeholder)
	}
	m.input.SetValue("看一下日志")
	if _, handled := m.handleKey(tea.KeyPressMsg{Code: tea.KeyEnter}); !handled {
		t.Fatal("typed answer was not sent")
	}
	if got := lastUserText(t, m); got != "看一下日志" {
		t.Fatalf("sent %q", got)
	}
}

func questionModel(t *testing.T, question string) *model {
	t.Helper()
	input, err := json.Marshal(map[string]string{"question": question})
	if err != nil {
		t.Fatal(err)
	}
	content, err := json.Marshal([]api.Part{{
		Type: "tool-call", ToolName: "ask_followup_question", ToolCallID: "q", Input: input,
	}})
	if err != nil {
		t.Fatal(err)
	}
	return newModel(context.Background(), nil, api.Session{ID: "s", History: []api.Message{{
		Role: "assistant", MessageID: "a", Content: content,
	}}})
}

func lastUserText(t *testing.T, m *model) string {
	t.Helper()
	if len(m.session.History) == 0 {
		t.Fatal("no history")
	}
	var text string
	if err := json.Unmarshal(m.session.History[len(m.session.History)-1].Content, &text); err != nil {
		t.Fatal(err)
	}
	return text
}

func TestSessionOverlayFilters(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.overlay.kind = "sessions"
	m.overlay.sessions = []api.Session{{ID: "keep-me", Title: "alpha"}, {ID: "hide-me", Title: "beta"}}
	m.overlay.filter = "alpha"
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 30})
	view := m.View().Content
	if !strings.Contains(view, "keep-me") || strings.Contains(view, "hide-me") || strings.Contains(view, "beta") {
		t.Fatalf("filter failed: %s", view)
	}
	if strings.Index(view, "alpha") < 0 || strings.Index(view, "alpha") > strings.Index(view, "keep-me") {
		t.Fatalf("title should lead the row:\n%s", view)
	}
}

func TestHeaderKeepsTitleAndShortDirectory(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		t.Fatal(err)
	}
	m := newModel(context.Background(), nil, api.Session{
		ID: "s", Title: "看板", Provider: "local", Model: "qwen",
		Cwd:      home + "/code/agent",
		Settings: api.Settings{Reasoning: "high"},
	})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	view := m.View()
	lines := strings.Split(view.Content, "\n")
	if len(lines) != 24 {
		t.Fatalf("frame height %d", len(lines))
	}
	if lipgloss.Width(lines[0]) > 78 || !strings.Contains(lines[0], "看板") || !strings.Contains(lines[0], "~/code/agent") || strings.Contains(lines[0], home) {
		t.Fatalf("header %q width %d", lines[0], lipgloss.Width(lines[0]))
	}
	if !strings.Contains(lines[0], "local/qwen") || !strings.Contains(lines[0], "high") {
		t.Fatalf("meta missing %q", lines[0])
	}
	if !strings.Contains(view.Content, "直接输入") || !strings.Contains(view.Content, "模型") {
		t.Fatalf("welcome missing:\n%s", view.Content)
	}
}

func TestLongDirectoryKeepsItsLeaf(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		t.Fatal(err)
	}
	leaf := "workspace-leaf"
	m := newModel(context.Background(), nil, api.Session{
		ID: "s", Title: "看板",
		Cwd: home + "/projects/" + strings.Repeat("very-long-directory/", 6) + leaf,
	})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	line := strings.Split(m.View().Content, "\n")[0]
	if lipgloss.Width(line) > 78 || !strings.Contains(line, "看板") || !strings.Contains(line, leaf) || strings.Contains(line, home) {
		t.Fatalf("header %q width %d", line, lipgloss.Width(line))
	}
}

func TestFooterKeepsUsageAndShortcut(t *testing.T) {
	text, _ := json.Marshal("hello")
	usage, _ := json.Marshal(map[string]int{"input": 9, "output": 8, "cacheRead": 7})
	m := newModel(context.Background(), nil, api.Session{
		ID: "s", Provider: "p", Model: "q",
		History: []api.Message{{Role: "assistant", Content: text, Usage: usage}},
	})
	m.config.Providers = []struct {
		Name    string `json:"name"`
		Enabled *bool  `json:"enabled"`
		Models  []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Context int    `json:"context"`
		} `json:"models"`
	}{{
		Name: "p",
		Models: []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Context int    `json:"context"`
		}{{ID: "q", Context: 100}},
	}}
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	lines := strings.Split(m.View().Content, "\n")
	last := lines[len(lines)-1]
	if !strings.Contains(last, "上下文 9%") || !strings.Contains(last, "入 9") || !strings.Contains(last, "ctrl+") {
		t.Fatalf("footer clipped a side: %q", last)
	}
	if m.statsWidth < 8 || m.statsWidth >= 78 {
		t.Fatalf("stats click width %d", m.statsWidth)
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: m.statsWidth, Y: m.height - 1, Button: tea.MouseLeft}); cmd != nil || m.overlay.kind != "" {
		t.Fatalf("shortcut click opened stats: %q", m.overlay.kind)
	}
	if _, cmd := m.Update(tea.MouseClickMsg{X: 1, Y: m.height - 1, Button: tea.MouseLeft}); cmd != nil || m.overlay.kind != "stats" {
		t.Fatalf("usage click missed: %q", m.overlay.kind)
	}
}

func TestActivityNamesTheRunningTool(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.running = true
	m.turnAt = time.Now().Add(-3 * time.Second)
	m.status = "正在请求模型…"
	m.tools = map[string]api.Tool{"read_file": {Name: "read_file", UI: struct {
		Title   string `json:"title"`
		Summary string `json:"summary"`
		Icon    string `json:"icon"`
	}{Title: "读取文件", Summary: "{path}"}}}
	m.steps = []liveStep{{kind: "tool", tool: &liveTool{
		id: "c", name: "read_file", running: true, input: json.RawMessage(`{"path":"main.go"}`),
	}}}
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	got := m.activityLine()
	if !strings.Contains(got, "s  读取文件") || !strings.Contains(got, "main.go") || strings.Contains(got, "正在请求") {
		t.Fatalf("activity %q", got)
	}
	m.steps = nil
	m.liveReasoning = "先看目录"
	if got := m.activityLine(); !strings.Contains(got, "正在思考") {
		t.Fatalf("thinking %q", got)
	}
	m.running = false
	m.busy = true
	m.status = "就绪"
	if m.activityLine() != "" {
		t.Fatalf("idle command showed %q", m.activityLine())
	}
}
