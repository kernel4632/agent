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
	}{{'y', "allow-once"}, {'a', "allow-always"}, {'n', "deny"}} {
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
	if !strings.Contains(m.panel, "/open") || !strings.Contains(m.panel, "/reasoning") {
		t.Fatal("missing help")
	}
}
