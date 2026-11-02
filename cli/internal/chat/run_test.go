package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kernel4632/agent/cli/internal/api"
)

func TestRunIgnoresPreviousFinishAndSavesPartialOnCancel(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	sent := make(chan struct{})
	stopped := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sse/connect/s":
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"type\":\"agent-finish\",\"error\":\"old error\"}\n\n")
			w.(http.Flusher).Flush()
			<-sent
			fmt.Fprint(w, "data: {\"type\":\"agent-start\"}\n\ndata: {\"type\":\"text-delta\",\"text\":\"压缩摘要\",\"request\":\"compact\"}\n\ndata: {\"type\":\"text-delta\",\"text\":\"半段回复\"}\n\n")
			w.(http.Flusher).Flush()
			<-r.Context().Done()
		case "/agent/send/s":
			close(sent)
			fmt.Fprint(w, `{"ok":true}`)
		case "/agent/stop/s":
			var body struct{ Partial struct{ Content string } }
			_ = json.NewDecoder(r.Body).Decode(&body)
			stopped <- body.Partial.Content
			fmt.Fprint(w, `{"ok":true}`)
		}
	}))
	defer server.Close()
	client, _ := api.New(server.URL)
	err := Run(ctx, client, api.Session{ID: "s"}, "send", "hello", Hooks{Event: func(e api.Event) {
		if e.Type == "text-delta" && !e.IsCompact() {
			cancel()
		}
	}})
	if err == nil {
		t.Fatal("expected cancellation")
	}
	select {
	case content := <-stopped:
		if content != "半段回复" {
			t.Fatalf("partial lost: %q", content)
		}
	default:
		t.Fatal("server was not stopped")
	}
}

func TestReconnectReadsHistoryWithoutResendingOrLastEventID(t *testing.T) {
	var connections, sends, reads atomic.Int32
	sent := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sse/connect/s":
			if r.Header.Get("Last-Event-ID") != "" {
				t.Error("must not send Last-Event-ID")
			}
			w.Header().Set("Content-Type", "text/event-stream")
			w.(http.Flusher).Flush()
			if connections.Add(1) == 1 {
				<-sent
				fmt.Fprint(w, "data: {\"type\":\"agent-start\"}\n\n")
			} else {
				if reads.Load() == 0 {
					t.Error("reconnect did not read history first")
				}
				fmt.Fprint(w, "data: {\"type\":\"agent-finish\",\"error\":\"model failed\"}\n\n")
			}
		case "/agent/send/s":
			sends.Add(1)
			close(sent)
			fmt.Fprint(w, `{"ok":true}`)
		case "/session/read/s":
			reads.Add(1)
			fmt.Fprint(w, `{"id":"s","running":false,"history":[],"pending":[]}`)
		}
	}))
	defer server.Close()
	client, _ := api.New(server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := Run(ctx, client, api.Session{ID: "s"}, "send", "hello", Hooks{})
	if err == nil || !strings.Contains(err.Error(), "model failed") {
		t.Fatalf("lost terminal failure: %v", err)
	}
	if sends.Load() != 1 || reads.Load() != 1 {
		t.Fatalf("sends=%d reads=%d", sends.Load(), reads.Load())
	}
}

func TestControlToolAnswerAndReasoning(t *testing.T) {
	message := api.Message{Role: "assistant", Content: json.RawMessage(`[{"type":"reasoning","text":"thought"},{"type":"tool-call","toolName":"attempt_completion","input":{"result":"完成"}}]`)}
	if got := MessageText(message, false); got != "完成" {
		t.Fatal(got)
	}
	if got := MessageText(message, true); !strings.Contains(got, "thought") {
		t.Fatal(got)
	}
	if got := Plain("\x1b[2Jhello\x07"); strings.ContainsAny(got, "\x1b\x07") {
		t.Fatal("terminal control passed through")
	}
}

func TestLateSubscriptionStillHandlesApprovalAfterStartWasCleared(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	decided := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/agent/send/s":
			fmt.Fprint(w, `{"ok":true}`)
		case "/agent/decide/s":
			close(decided)
			fmt.Fprint(w, `{"ok":true}`)
		case "/sse/connect/s":
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"type\":\"permission\",\"callID\":\"c\",\"tool\":\"read_file\"}\n\n")
			w.(http.Flusher).Flush()
			select {
			case <-decided:
			case <-r.Context().Done():
				return
			}
			fmt.Fprint(w, "data: {\"type\":\"agent-finish\"}\n\n")
		}
	}))
	defer server.Close()
	client, _ := api.New(server.URL)
	err := Run(ctx, client, api.Session{ID: "s"}, "send", "test", Hooks{
		Permission: func(ctx context.Context, p api.Permission) error {
			return client.Decide(ctx, "s", p.CallID, "allow-once")
		},
	})
	if err != nil {
		t.Fatal(err)
	}
}
