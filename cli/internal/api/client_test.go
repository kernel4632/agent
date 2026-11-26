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

func TestSplitArgsAndScalars(t *testing.T) {
	fields, err := SplitArgs(`"first arg" 'second\path' plain`)
	if err != nil || len(fields) != 3 || fields[0] != "first arg" || fields[1] != `second\path` || fields[2] != "plain" {
		t.Fatalf("SplitArgs failed: %#v err=%v", fields, err)
	}
	if _, err := SplitArgs(`"unclosed`); err == nil {
		t.Fatal("expected unclosed quote error")
	}
	if got := ParseScalarArg("true"); got != true {
		t.Fatalf("bool true got %#v", got)
	}
	if got := ParseScalarArg("false"); got != false {
		t.Fatalf("bool false got %#v", got)
	}
	if got := ParseScalarArg("001"); got != "001" {
		t.Fatalf("leading zero string corrupted: %#v", got)
	}
	if got := ParseScalarArg("42"); got != int64(42) {
		t.Fatalf("int got %#v", got)
	}
}

func TestExtensionBodyParamsAndErrors(t *testing.T) {
	decl := ExtensionCommand{
		Name:   "skill-toggle",
		Usage:  "技能名 on|off",
		Op:     "skill.toggle",
		Cwd:    true,
		Args:   map[string]any{"source": "cli"},
		Params: []string{"name", "enabled:bool"},
	}
	body, err := ExtensionBody(decl, "sess-1", "/work", `"my skill" off`)
	if err != nil {
		t.Fatal(err)
	}
	if body["name"] != "my skill" || body["enabled"] != false || body["cwd"] != "/work" || body["sessionId"] != "sess-1" || body["source"] != "cli" {
		t.Fatalf("unexpected body: %#v", body)
	}
	if _, err := ExtensionBody(decl, "sess-1", "/work", `one maybe`); err == nil {
		t.Fatal("expected invalid bool error")
	}
	if _, err := ExtensionBody(decl, "sess-1", "/work", `a on extra`); err == nil {
		t.Fatal("expected too many args error")
	}
	noArgs := ExtensionCommand{Name: "skills", Op: "skill.list", NoSession: true}
	if _, err := ExtensionBody(noArgs, "", "", "unexpected"); err == nil {
		t.Fatal("expected error for unexpected args")
	}
	body, err = ExtensionBody(ExtensionCommand{Name: "skill-read", Op: "skill.read", NoSession: true, Input: "name"}, "s", "", "review code")
	if err != nil || body["name"] != "review code" {
		t.Fatalf("input mapping failed: %#v err=%v", body, err)
	}
	if _, ok := body["sessionId"]; ok {
		t.Fatal("noSession command leaked sessionId")
	}
}
