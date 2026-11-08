package render

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSanitizeKeepsColorAndDropsScreenControl(t *testing.T) {
	in := "ok\x1b[32m绿\x1b[0m\x1b[2J\x1b[H\x07"
	out := Sanitize(in)
	if !strings.Contains(out, "\x1b[32m绿\x1b[0m") {
		t.Fatalf("color lost: %q", out)
	}
	if strings.Contains(out, "\x1b[2J") || strings.Contains(out, "\x1b[H") || strings.Contains(out, "\x07") {
		t.Fatalf("screen control survived: %q", out)
	}
}

func TestMarkdownRendersFenceAndInlineCode(t *testing.T) {
	out := Markdown("# 标题\n\n看 `main.go`\n\n```go\nfmt.Println(\"hi\")\n```\n")
	if strings.Contains(out, "```") {
		t.Fatalf("fence markers leaked: %q", out)
	}
	if !strings.Contains(out, "fmt.Println") || !strings.Contains(out, "main.go") || !strings.Contains(out, "标题") {
		t.Fatalf("markdown dropped content: %q", out)
	}
	if !strings.Contains(out, "go") {
		t.Fatalf("language label missing: %q", out)
	}
}

func TestApplyWalksNestedPath(t *testing.T) {
	input := json.RawMessage(`{"from":"a.go","patches":[{"path":"b.go"}]}`)
	if got := Apply("{from} → {patches.0.path}", input); got != "a.go → b.go" {
		t.Fatal(got)
	}
	if got := Apply("{missing}", input); got != "" {
		t.Fatal(got)
	}
}

func TestUnifiedAndPaintMarkAddedLine(t *testing.T) {
	text, added, removed := Unified("old\n", "old\nnew\n")
	if added != 1 || removed != 0 || !strings.Contains(text, "+new") {
		t.Fatalf("diff = %q added=%d removed=%d", text, added, removed)
	}
	painted := Paint(text)
	if !strings.Contains(painted, "+new") {
		t.Fatal(painted)
	}
	if !strings.Contains(painted, "\x1b[") {
		t.Fatal("added line was not colored")
	}
}

func TestOutcomeClassifiesDenial(t *testing.T) {
	label, kind := Outcome(json.RawMessage(`{"type":"execution-denied","reason":"no"}`), false)
	if label != "已拒绝" || kind != "rejected" {
		t.Fatal(label, kind)
	}
	label, kind = Outcome(nil, true)
	if kind != "running" {
		t.Fatal(label, kind)
	}
}

func TestClipReportsHiddenLines(t *testing.T) {
	got := Clip("a\nb\nc", 2)
	if !strings.Contains(got, "a\nb") || !strings.Contains(got, "1 行已截断") {
		t.Fatal(got)
	}
}
