package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestApprovalUsesCurrentContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/agent/decide/session-1" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["toolCallId"] != "call-1" || body["decision"] != "allow" || len(body) != 2 {
			t.Errorf("wrong approval payload: %v", body)
		}
		fmt.Fprint(w, `{"ok":true}`)
	}))
	defer server.Close()
	client, _ := New(server.URL)
	if err := client.Decide(context.Background(), "session-1", "call-1", "allow"); err != nil {
		t.Fatal(err)
	}
}

func TestHTTPErrorAndExpiredApproval(t *testing.T) {
	for _, status := range []int{400, 404, 409, 500, 200} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				fmt.Fprint(w, `{"ok":false,"error":"session busy"}`)
			}))
			defer server.Close()
			client, _ := New(server.URL)
			err := client.Decide(context.Background(), "s", "c", "deny")
			if err == nil {
				t.Fatal("expected failure")
			}
			if status != 200 {
				var httpErr *HTTPError
				if !errors.As(err, &httpErr) || httpErr.Status != status || httpErr.Message != "session busy" {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestSSELongMultilineAndHeartbeat(t *testing.T) {
	text := strings.Repeat("中文", 40000)
	wire := ": heartbeat\r\nid: 1\r\nevent: message\r\ndata: {\r\ndata: \"type\":\"text-delta\",\"text\":\"" + text + "\"}\r\n\r\n"
	stop := errors.New("done")
	err := ReadEvents(strings.NewReader(wire), func(e Event) error {
		if e.Type != "text-delta" || e.Text != text {
			t.Fatal("incorrect decoded event")
		}
		return stop
	})
	if !errors.Is(err, stop) {
		t.Fatal(err)
	}
	if err := ReadEvents(strings.NewReader("data: invalid\n\n"), func(Event) error { return nil }); err == nil {
		t.Fatal("malformed JSON must fail")
	}
}
