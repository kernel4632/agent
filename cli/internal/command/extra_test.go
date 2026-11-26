package command

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthToolsAndChangesAreHumanByDefault(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			fmt.Fprint(w, `{"ok":true,"version":"0.66.1","targetVersion":"0.66.1","sessions":2,"running":1}`)
		case "/admin": // tools 走管理总线：POST /admin，body 带 op
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["op"] != "tool.list" {
				t.Errorf("unexpected op: %v", body["op"])
			}
			fmt.Fprint(w, `[{"name":"read_file","kind":"read","kindLabel":"读取","permission":"ask","ui":{"title":"读取文件","summary":"{path}"}}]`)
		case "/session/changes/s":
			fmt.Fprint(w, `[{"path":"main.go","before":"old","after":"old\nnew","added":false,"deleted":false}]`)
		default:
			t.Errorf("unexpected %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	for _, args := range [][]string{{"health"}, {"tools"}, {"sessions", "changes", "s"}} {
		cmd := New()
		var out bytes.Buffer
		cmd.SetOut(&out)
		cmd.SetArgs(append([]string{"--server", server.URL}, args...))
		if err := cmd.Execute(); err != nil {
			t.Fatal(args, err)
		}
		if strings.Contains(out.String(), `"ok"`) || strings.Contains(out.String(), `"kind"`) {
			t.Fatalf("raw JSON leaked for %v: %s", args, out.String())
		}
	}
	cmd := New()
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetArgs([]string{"--server", server.URL, "sessions", "changes", "s"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "main.go") || !strings.Contains(out.String(), "+new") {
		t.Fatal(out.String())
	}
	cmd = New()
	out.Reset()
	cmd.SetOut(&out)
	cmd.SetArgs([]string{"--server", server.URL, "health", "--json"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `"version"`) {
		t.Fatal(out.String())
	}
}

func TestMCPListHidesCredentialsAndRollbackSendsFilesFlag(t *testing.T) {
	var rollback map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/admin":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["op"] != "mcp.list" {
				t.Errorf("unexpected op: %v", body["op"])
			}
			fmt.Fprint(w, `{"servers":[{"name":"demo","enabled":true,"definition":{"command":"bun","args":["serve.js"],"env":{"TOKEN":"SECRET"}}}],"detected":{"servers":[{"id":"cursor::demo","name":"demo","app":"Cursor","configured":true}]}}`)
		case r.URL.Path == "/session/rollback/s":
			if err := json.NewDecoder(r.Body).Decode(&rollback); err != nil {
				t.Error(err)
			}
			fmt.Fprint(w, `{"id":"s","title":"回退后","restored":["a.go"]}`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	cmd := New()
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetArgs([]string{"--server", server.URL, "mcp", "list", "--json"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "SECRET") || !strings.Contains(out.String(), "bun") {
		t.Fatal(out.String())
	}
	cmd = New()
	out.Reset()
	cmd.SetOut(&out)
	cmd.SetErr(&bytes.Buffer{})
	cmd.SetArgs([]string{"--server", server.URL, "sessions", "rollback", "s", "m1", "--keep-files"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if rollback["messageId"] != "m1" || rollback["files"] != false {
		t.Fatalf("rollback body: %v", rollback)
	}
	if !strings.Contains(out.String(), "回退后") || strings.Contains(out.String(), `"restored"`) {
		t.Fatal(out.String())
	}
}

func TestAskOnAPipePrintsTheFinalAnswerOnce(t *testing.T) {
	var reads int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/session/create":
			fmt.Fprint(w, `{"sessionId":"s"}`)
		case "/session/read/s":
			reads++
			if reads == 1 {
				fmt.Fprint(w, `{"id":"s","title":"t","history":[]}`)
				return
			}
			fmt.Fprint(w, `{"id":"s","title":"t","history":[{"role":"user","content":"你好"},{"role":"assistant","content":"流式答复"}]}`)
		case "/agent/send/s":
			fmt.Fprint(w, `{"ok":true}`)
		case "/sse/connect/s":
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"type\":\"agent-start\"}\n\ndata: {\"type\":\"text-delta\",\"text\":\"流式\"}\n\ndata: {\"type\":\"text-delta\",\"text\":\"答复\"}\n\ndata: {\"type\":\"agent-finish\"}\n\n")
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			<-r.Context().Done()
		default:
			t.Errorf("unexpected %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	cmd := New()
	var out, errBuf bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&errBuf)
	cmd.SetArgs([]string{"--server", server.URL, "ask", "你好", "--cwd", t.TempDir()})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err, errBuf.String())
	}
	if out.String() != "流式答复\n" {
		t.Fatalf("stdout = %q", out.String())
	}
}

func TestWriteAnswerDoesNotRepeatStreamedText(t *testing.T) {
	var buf bytes.Buffer
	if err := writeAnswer(&buf, true, "流式答复", "流式答复"); err != nil {
		t.Fatal(err)
	}
	if buf.String() != "\n" {
		t.Fatalf("repeated the streamed answer: %q", buf.String())
	}
	buf.Reset()
	if err := writeAnswer(&buf, true, "过程", "最终答复"); err != nil {
		t.Fatal(err)
	}
	if buf.String() != "\n最终答复\n" {
		t.Fatal(buf.String())
	}
	buf.Reset()
	if err := writeAnswer(&buf, false, "流式答复", "流式答复"); err != nil {
		t.Fatal(err)
	}
	if buf.String() != "流式答复\n" {
		t.Fatal(buf.String())
	}
}

func TestExtensionsListToggleReloadAndCall(t *testing.T) {
	var calls []map[string]any
	extJSON := `{"extensions":[{"name":"monitor","title":"监控唤醒","version":"1.1.1","source":"project","enabled":true,"running":true,"changed":true,"description":"后台监控","cli":{"commands":[{"name":"monitors","hint":"看监控","usage":"[会话 ID]","op":"monitor.list","params":["sessionId"],"view":{"kind":"list","title":"后台监控","empty":"无","items":"monitors","fields":[{"key":"id","label":"编号"},{"key":"status","label":"状态"}]}},{"name":"monitor-stop","hint":"停监控","usage":"编号|all [会话 ID]","op":"monitor.stop","params":["id","sessionId"]}]}}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		calls = append(calls, body)
		switch body["op"] {
		case "extension.list", "extension.toggle", "extension.reload":
			fmt.Fprint(w, extJSON)
		case "monitor.list":
			fmt.Fprint(w, `{"monitors":[{"id":"m1","status":"armed"}]}`)
		case "monitor.stop":
			fmt.Fprint(w, `["m1"]`)
		default:
			w.WriteHeader(400)
			fmt.Fprintf(w, `{"error":"unknown op: %v"}`, body["op"])
		}
	}))
	defer server.Close()

	run := func(args ...string) (string, error) {
		cmd := New()
		var out, errBuf bytes.Buffer
		cmd.SetOut(&out)
		cmd.SetErr(&errBuf)
		cmd.SetArgs(append([]string{"--server", server.URL}, args...))
		err := cmd.Execute()
		return out.String(), err
	}

	out, err := run("extensions", "list")
	if err != nil || !strings.Contains(out, "监控唤醒") || !strings.Contains(out, "代码有更新") || !strings.Contains(out, "/monitors") {
		t.Fatalf("list out=%q err=%v", out, err)
	}
	if _, err := run("extensions", "toggle", "monitor", "off"); err != nil {
		t.Fatal(err)
	}
	if _, err := run("extensions", "reload", "monitor"); err != nil {
		t.Fatal(err)
	}
	out, err = run("extensions", "call", "monitors", "--session", "s1")
	if err != nil || !strings.Contains(out, "后台监控") || !strings.Contains(out, "m1") || strings.Contains(out, `"monitors"`) {
		t.Fatalf("human list view failed: out=%q err=%v", out, err)
	}
	if _, err := run("extensions", "call", "monitor-stop", "m1", "--session", "s1", "--arg", "all=false"); err != nil {
		t.Fatal(err)
	}
	last := calls[len(calls)-1]
	if last["op"] != "monitor.stop" || last["id"] != "m1" || last["sessionId"] != "s1" || last["all"] != false {
		t.Fatalf("monitor-stop payload = %#v", last)
	}
	if _, err := run("extensions", "call", "monitors"); err == nil {
		t.Fatal("expected missing session error")
	}
	if _, err := run("extensions", "call", "monitors", "--session", "s1", "--arg", "badarg"); err == nil {
		t.Fatal("expected invalid --arg error")
	}
}
