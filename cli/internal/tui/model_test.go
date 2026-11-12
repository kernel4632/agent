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

func TestReasoningStreamsOpenAndCtrlRTucksItAway(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.Update(tea.WindowSizeMsg{Width: 60, Height: 25})
	m.Update(api.Event{Type: "reasoning-delta", Text: "思考第一段"})
	if !strings.Contains(m.View().Content, "思考第一段") {
		t.Fatal("reasoning should stream open")
	}
	m.Update(press('r', tea.ModCtrl))
	if strings.Contains(m.View().Content, "思考第一段") {
		t.Fatal("ctrl+r did not collapse the reasoning")
	}
	m.Update(api.Event{Type: "reasoning-delta", Text: "思考第二段"})
	if strings.Contains(m.View().Content, "思考第二段") {
		t.Fatal("collapsed reasoning reopened on the next chunk")
	}
	m.Update(api.Event{Type: "text-delta", Text: "正文"})
	if !strings.Contains(m.View().Content, "正文") {
		t.Fatal("answer missing")
	}
}

func TestReasoningCollapsesOnceTheAnswerIsOut(t *testing.T) {
	m := newModel(context.Background(), nil, api.Session{ID: "s"})
	m.Update(tea.WindowSizeMsg{Width: 60, Height: 25})
	m.running = true
	m.Update(api.Event{Type: "reasoning-delta", Text: "先看目录"})
	if !strings.Contains(m.View().Content, "先看目录") {
		t.Fatal("reasoning should be readable while it streams")
	}
	m.finalAnswer = "看完了，端口被占用"
	m.renderConversation(true)
	view := m.View().Content
	if strings.Contains(view, "先看目录") {
		t.Fatalf("reasoning stayed open after the answer:\n%s", view)
	}
	if !strings.Contains(view, "看完了，端口被占用") {
		t.Fatalf("answer missing:\n%s", view)
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

func TestPickingAModelAsksForReasoningNext(t *testing.T) {
	var patched []map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PATCH" {
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			patched = append(patched, body)
			fmt.Fprint(w, `{}`)
			return
		}
		fmt.Fprint(w, `{"id":"s","provider":"p","model":"fast","settings":{"reasoning":"high"}}`)
	}))
	defer server.Close()
	client, _ := api.New(server.URL)
	m := newModel(context.Background(), client, api.Session{
		ID: "s", Provider: "p", Model: "slow", Settings: api.Settings{Reasoning: "high"},
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
	}{{ID: "slow"}, {ID: "fast"}}}}
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	if cmd := m.openModels(); cmd != nil {
		t.Fatal("models were already loaded from config")
	}
	m.overlay.index = 1 // 选第二个模型
	cmd, handled := m.handleKey(tea.KeyPressMsg{Code: tea.KeyEnter})
	if !handled || cmd == nil {
		t.Fatal("enter did not send the model change")
	}
	m.Update(cmd())
	if m.overlay.kind != "reasoning" {
		t.Fatalf("overlay = %q, want reasoning after picking a model", m.overlay.kind)
	}
	cmd, handled = m.handleKey(tea.KeyPressMsg{Code: tea.KeyEnter})
	if !handled || cmd == nil {
		t.Fatal("enter did not send the reasoning level")
	}
	m.Update(cmd())
	if m.overlay.kind != "" {
		t.Fatalf("overlay stayed open: %q", m.overlay.kind)
	}
	if len(patched) != 2 || patched[0]["model"] != "fast" || patched[1]["reasoning"] == "" {
		t.Fatalf("patched %v", patched)
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
