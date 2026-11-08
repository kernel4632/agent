/*
对话记录：用户的话和回答留在画面上，工具调用默认收成一行。
连续几次工具合成一行，点那一行或 Enter 再展开；正在跑的输出不铺满屏幕。
*/
package tui

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/kernel4632/agent/cli/internal/api"
	"github.com/kernel4632/agent/cli/internal/chat"
	"github.com/kernel4632/agent/cli/internal/render"
)

type block struct {
	id, kind, title, body, plain, copy string
	messageID, toolCallID, status      string
	live                               bool // 正在生成的块：思考在回答出来前自己展开
}

type blockSpan struct {
	index      int
	start, end int
	summary    bool // 这一行代表连续的多次工具，点击是展开整串，不是打开其中一次
}

type liveStep struct {
	kind string
	text string
	tool *liveTool
}

type liveTool struct {
	id, name string
	input    json.RawMessage
	stream   strings.Builder
	result   json.RawMessage
	running  bool
	started  time.Time
	duration time.Duration
}

type usageSnap struct {
	Input, Output, CacheRead, CacheWrite, Reasoning, Total int
	DurationMs, FirstTokenMs, FinishedAt                   int64
	Provider, Model                                        string
}

func (m *model) rebuild() {
	previous := m.selectedID
	m.blocks = append(m.historyBlocks(), m.liveBlocks()...)
	m.selected = 0
	m.selectedID = ""
	if len(m.blocks) == 0 {
		return
	}
	for i, item := range m.blocks {
		if item.id == previous {
			m.selected = i
			m.selectedID = item.id
			return
		}
	}
	m.selected = len(m.blocks) - 1
	m.selectedID = m.blocks[m.selected].id
}

func (m *model) historyBlocks() []block {
	results := map[string]api.Part{}
	for _, message := range m.session.History {
		for _, part := range contentParts(message.Content) {
			if part.Type != "tool-result" && message.Role != "tool" {
				continue
			}
			if part.ToolCallID == "" && part.ToolName == "" {
				continue
			}
			id := part.ToolCallID
			if id == "" {
				id = part.ToolName
			}
			results[id] = part
		}
	}
	used := map[string]bool{}
	var blocks []block
	for _, message := range m.session.History {
		if message.Compact {
			text := strings.TrimSpace(chat.MessageText(message, false))
			blocks = append(blocks, block{
				id: "compact-" + message.MessageID, kind: "compact", title: "上下文已压缩",
				body: text, plain: text, copy: text, messageID: message.MessageID,
			})
			continue
		}
		if text, parts := splitContent(message.Content); len(parts) == 0 {
			if strings.TrimSpace(text) == "" {
				continue
			}
			kind := "answer"
			title := "Agent"
			if message.Role == "user" {
				kind, title = "user", "你"
			} else if message.Role == "tool" {
				kind, title = "tool", "工具结果"
			}
			blocks = append(blocks, block{
				id: messageID(message), kind: kind, title: title,
				body: text, plain: text, copy: text, messageID: message.MessageID,
			})
			continue
		}
		blocks = append(blocks, m.partBlocks(message, results, used)...)
	}
	return blocks
}

func (m *model) partBlocks(message api.Message, results map[string]api.Part, used map[string]bool) []block {
	_, parts := splitContent(message.Content)
	var answers []string
	for _, part := range parts {
		if part.Type == "tool-call" {
			if answer := chat.ControlAnswer(part.ToolName, part.Input); answer != "" {
				answers = append(answers, answer)
			}
		}
	}
	last := ""
	if len(answers) > 0 {
		last = answers[len(answers)-1]
	}
	answered := false
	var blocks []block
	for index, part := range parts {
		switch part.Type {
		case "reasoning":
			if strings.TrimSpace(part.Text) == "" {
				continue
			}
			blocks = append(blocks, block{
				id: fmt.Sprintf("%s-reason-%d", message.MessageID, index), kind: "reasoning", title: "思考",
				body: part.Text, plain: part.Text, copy: part.Text, messageID: message.MessageID,
			})
		case "text":
			text := strings.TrimSpace(part.Text)
			if text == "" || text == strings.TrimSpace(last) {
				continue
			}
			blocks = append(blocks, block{
				id: fmt.Sprintf("%s-text-%d", message.MessageID, index), kind: "text", title: "过程",
				body: part.Text, plain: part.Text, copy: part.Text, messageID: message.MessageID,
			})
		case "tool-call":
			if answer := chat.ControlAnswer(part.ToolName, part.Input); answer != "" {
				if answer == last && answered {
					continue
				}
				if answer == last {
					answered = true
				}
				title := "Agent"
				kind := "answer"
				if part.ToolName == "ask_followup_question" {
					kind, title = "question", "需要你回答"
				}
				blocks = append(blocks, block{
					id: "answer-" + part.ToolCallID, kind: kind, title: title,
					body: answer, plain: answer, copy: answer, messageID: message.MessageID, toolCallID: part.ToolCallID,
				})
				continue
			}
			id := part.ToolCallID
			result := results[id]
			used[id] = true
			blocks = append(blocks, m.toolBlock(message.MessageID, id, part.ToolName, part.Input, result.Output, "", false, 0))
		}
	}
	return blocks
}

func (m *model) liveBlocks() []block {
	var blocks []block
	for index, step := range m.steps {
		switch step.kind {
		case "reasoning":
			blocks = append(blocks, block{id: fmt.Sprintf("live-%d-reason-%d", m.runID, index), kind: "reasoning", live: true, title: "思考", body: step.text, plain: step.text, copy: step.text})
		case "text":
			blocks = append(blocks, block{id: fmt.Sprintf("live-text-%d", index), kind: "text", title: "过程", body: step.text, plain: step.text, copy: step.text})
		case "tool":
			if step.tool == nil {
				continue
			}
			if answer := chat.ControlAnswer(step.tool.name, step.tool.input); answer != "" {
				title := "Agent"
				kind := "answer"
				if step.tool.name == "ask_followup_question" {
					kind, title = "question", "需要你回答"
				}
				blocks = append(blocks, block{id: "live-answer-" + step.tool.id, kind: kind, title: title, body: answer, plain: answer, copy: answer, toolCallID: step.tool.id})
				continue
			}
			blocks = append(blocks, m.toolBlock("", step.tool.id, step.tool.name, step.tool.input, step.tool.result, step.tool.stream.String(), step.tool.running, step.tool.duration))
		}
	}
	if strings.TrimSpace(m.liveReasoning) != "" {
		blocks = append(blocks, block{id: fmt.Sprintf("live-%d-reason", m.runID), kind: "reasoning", title: "思考", live: true, body: m.liveReasoning, plain: m.liveReasoning, copy: m.liveReasoning})
	}
	if strings.TrimSpace(m.liveText) != "" && strings.TrimSpace(m.liveText) != strings.TrimSpace(m.finalAnswer) {
		blocks = append(blocks, block{id: "live-text", kind: "text", title: "Agent", body: m.liveText, plain: m.liveText, copy: m.liveText})
	}
	if strings.TrimSpace(m.finalAnswer) != "" {
		blocks = append(blocks, block{id: "live-final", kind: "answer", title: "Agent", body: m.finalAnswer, plain: m.finalAnswer, copy: m.finalAnswer})
	}
	return blocks
}

func (m *model) toolBlock(messageID, callID, name string, input, output json.RawMessage, stream string, running bool, duration time.Duration) block {
	title, summary := m.toolLabel(name, input)
	label, kind := render.Outcome(output, running)
	if m.permission != nil && m.permission.permission.CallID == callID {
		label, kind = "等待许可", "waiting"
	}
	raw := chat.Output(output)
	if strings.TrimSpace(raw) == "" {
		raw = stream
	}
	body := raw
	if render.LooksLikeDiff(body) {
		body = render.Paint(body)
	} else {
		body = render.Sanitize(body)
	}
	plain := summary
	if plain == "" {
		plain = title
	}
	copied := strings.TrimSpace(raw)
	if summary != "" && copied != "" && summary != copied {
		copied = summary + "\n\n" + copied
	} else if copied == "" {
		copied = plain
	}
	status := label
	if text := durationText(duration); text != "" {
		status += " · " + text
	} else if timing, ok := m.session.ToolTimings[callID]; ok {
		if text := durationText(time.Duration(timing.DurationMs) * time.Millisecond); text != "" {
			status += " · " + text
		}
	}
	return block{
		id: "tool-" + callID, kind: "tool", title: title, body: body, plain: plain, copy: copied,
		messageID: messageID, toolCallID: callID, status: status + "\x00" + kind,
	}
}

func (m *model) toolLabel(name string, input json.RawMessage) (string, string) {
	title := name
	template := ""
	if info, ok := m.tools[name]; ok {
		if info.UI.Title != "" {
			title = info.UI.Title
		}
		template = info.UI.Summary
	}
	summary := render.Apply(template, input)
	if summary == "" {
		summary = previewInput(input)
	}
	return title, summary
}

func (m *model) blockOpen(item block) bool {
	if item.kind == "approval" || item.kind == "user" || item.kind == "answer" || item.kind == "text" || item.kind == "question" {
		return true
	}
	if value, ok := m.open[item.id]; ok {
		return value // 手动点过的以点击为准，包括把自动展开的思考收回
	}
	if item.kind == "reasoning" {
		if m.showReasoning {
			return true
		}
		return item.live && !m.answerDone() // 思考边生成边展开，回答一出来就收起
	}
	return false // 工具无论是否还在跑都先收着，避免输出把回答顶出屏幕
}

// answerDone 表示最后一条回答已经生成，思考该让位了。
func (m *model) answerDone() bool {
	return strings.TrimSpace(m.finalAnswer) != ""
}

// anyReasoningOpen 报告当前有没有展开的思考，Ctrl+R 用它决定这次是开还是合。
func (m *model) anyReasoningOpen() bool {
	for _, item := range m.blocks {
		if item.kind == "reasoning" && m.blockOpen(item) {
			return true
		}
	}
	return false
}

// toolRun 找出从 index 开始的连续工具。只有两行以上、且没有被点开时才收成一行。
func (m *model) toolRun(index int) (end int, collapse bool) {
	if index < 0 || index >= len(m.blocks) || m.blocks[index].kind != "tool" {
		return index, false
	}
	if index > 0 && m.blocks[index-1].kind == "tool" {
		return index, false // 这一串由第一行负责
	}
	end = index
	for end+1 < len(m.blocks) && m.blocks[end+1].kind == "tool" {
		end++
	}
	if end == index || m.toolList[m.blocks[index].id] {
		return end, false
	}
	for i := index; i <= end; i++ {
		if m.blockOpen(m.blocks[i]) {
			return end, false // 其中一次已经打开，整串都列出来
		}
	}
	return end, true
}

func (m *model) toolHidden(index int) bool {
	if index <= 0 || index >= len(m.blocks) || m.blocks[index].kind != "tool" {
		return false
	}
	first := index
	for first > 0 && m.blocks[first-1].kind == "tool" {
		first--
	}
	end, collapse := m.toolRun(first)
	return collapse && index > first && index <= end
}

func toolSummary(items []block) string {
	seen := map[string]bool{}
	var names []string
	running := false
	for _, item := range items {
		if item.title != "" && !seen[item.title] && len(names) < 3 {
			seen[item.title] = true
			names = append(names, item.title)
		}
		_, kind := splitStatus(item.status)
		if kind == "running" || kind == "waiting" {
			running = true
		}
	}
	text := "工具 " + itoa(len(items))
	if len(names) > 0 {
		text += " · " + strings.Join(names, "、")
	}
	if len(items) > len(names) && len(names) == 3 {
		text += " 等"
	}
	if running {
		text += "  正在执行"
	}
	return text
}

func splitStatus(status string) (label, kind string) {
	label, kind, _ = strings.Cut(status, "\x00")
	return label, kind
}

func (m *model) transcriptText() (string, int) {
	m.spans = m.spans[:0]
	if len(m.blocks) == 0 && m.permission == nil && !m.running && strings.TrimSpace(m.panel) == "" {
		return m.welcome(), 0
	}
	width := max(10, m.width-2)
	var b strings.Builder
	if m.toolHidden(m.selected) {
		for m.selected > 0 && m.toolHidden(m.selected) {
			m.selected-- // 收起后选中落在这一串的第一行，方向键不会停在看不见的工具上
		}
		m.selectedID = m.blocks[m.selected].id
	}
	selectedLine := 0
	visual := 0
	for index := 0; index < len(m.blocks); index++ {
		item := m.blocks[index]
		if index == m.selected {
			selectedLine = strings.Count(b.String(), "\n")
		}
		if end, collapse := m.toolRun(index); collapse {
			start := visual
			before := b.Len()
			marker := "  "
			if m.focus == focusTranscript && index == m.selected {
				marker = "> "
			}
			fmt.Fprintf(&b, "%s%s %s\n\n", marker, dim.Render("▸"), muted.Render(toolSummary(m.blocks[index:end+1])))
			visual += visualHeight(b.String()[before:], width)
			m.spans = append(m.spans, blockSpan{index: index, start: start, end: visual, summary: true})
			index = end // 这一串只占一行；循环自己还会 +1
			continue
		}
		start := visual
		before := b.Len()
		open := m.blockOpen(item)
		marker := "  "
		if m.focus == focusTranscript && index == m.selected {
			marker = "> "
		}
		switch item.kind {
		case "user":
			fmt.Fprintf(&b, "%s%s\n%s\n\n", marker, userLabel.Render("你"), quoteBar(render.Markdown(item.body)))
		case "question":
			if m.questionInDock(item.body) {
				fmt.Fprintf(&b, "%s%s\n\n", marker, muted.Render("? 问题在输入框上方"))
				break
			}
			fmt.Fprintf(&b, "%s%s\n%s\n\n", marker, accent.Render("? 需要你回答"), render.Markdown(item.body))
		case "answer", "text":
			body := render.Markdown(item.body)
			if marker == "> " {
				lines := strings.Split(body, "\n")
				lines[0] = accent.Render(">") + " " + lines[0]
				body = strings.Join(lines, "\n")
			}
			fmt.Fprintf(&b, "%s\n\n", body)
		case "reasoning":
			caret := "▸"
			if open {
				caret = "▾"
			}
			fmt.Fprintf(&b, "%s%s %s", marker, dim.Render(caret), muted.Render("思考"))
			if open {
				fmt.Fprintf(&b, "\n%s\n\n", render.Markdown(item.body))
			} else {
				fmt.Fprintf(&b, "%s\n\n", dim.Render("  已收起"))
			}
		case "compact":
			fmt.Fprintf(&b, "%s%s", marker, dim.Render("上下文已压缩"))
			if open && strings.TrimSpace(item.body) != "" {
				fmt.Fprintf(&b, "\n%s\n\n", muted.Render(render.Clip(render.Sanitize(item.body), 12)))
			} else {
				fmt.Fprintf(&b, "\n\n")
			}
		case "tool":
			label, kind := splitStatus(item.status)
			mark, style := toolMark(kind)
			caret := "▸"
			if open {
				caret = "▾"
			}
			fmt.Fprintf(&b, "%s%s %s %s", marker, style.Render(mark), dim.Render(caret), item.title)
			if item.plain != "" && item.plain != item.title {
				fmt.Fprintf(&b, "  %s", dim.Render(oneLine(item.plain, 72)))
			}
			if label != "" {
				fmt.Fprintf(&b, "  %s", style.Render(label))
			}
			b.WriteByte('\n')
			if open && strings.TrimSpace(item.body) != "" {
				fmt.Fprintf(&b, "%s\n", render.Clip(item.body, 80))
			}
			b.WriteByte('\n')
		case "approval":
			fmt.Fprintf(&b, "%s%s %s\n", marker, warnText.Render("!"), item.title)
			if item.plain != "" {
				fmt.Fprintf(&b, "%s\n", oneLine(item.plain, 100))
			}
			fmt.Fprintf(&b, "%s\n\n", item.body)
		}
		visual += visualHeight(b.String()[before:], width)
		m.spans = append(m.spans, blockSpan{index: index, start: start, end: visual})
	}
	return strings.TrimRight(b.String(), "\n"), selectedLine
}

func visualHeight(text string, width int) int {
	if text == "" || width < 1 {
		return 0
	}
	n := 0
	for _, line := range strings.Split(text, "\n") {
		w := lipgloss.Width(line)
		if w <= 0 {
			n++
			continue
		}
		n += (w + width - 1) / width
	}
	return n
}

func (m *model) welcome() string {
	modelName := strings.Trim(m.session.Provider+"/"+m.session.Model, "/")
	if modelName == "" {
		modelName = "未配置模型"
	}
	cwd := shortPath(m.session.Cwd, 64)
	if cwd == "" {
		cwd = "未设置目录"
	}
	lines := []string{
		accent.Render("Agent"),
		dim.Render("终端里的编码助手，与服务端共用会话、历史和工具权限"),
		"",
		"直接输入，发给当前会话。",
		"",
		gold.Render("模型  ") + modelName,
		gold.Render("目录  ") + cwd,
	}
	if reasoning := strings.TrimSpace(m.session.Settings.Reasoning); reasoning != "" {
		lines = append(lines, gold.Render("思考  ")+reasoning)
	}
	lines = append(lines,
		"",
		dim.Render("  /         命令"),
		dim.Render("  ctrl+p    已有会话"),
		dim.Render("  ctrl+m    切换模型"),
		dim.Render("  ctrl+u    用量统计"),
	)
	return strings.Join(lines, "\n")
}

func quoteBar(text string) string {
	if strings.TrimSpace(text) == "" {
		return ""
	}
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = userBar.Render("┃ ") + line
	}
	return strings.Join(lines, "\n")
}

func toolMark(kind string) (string, lipgloss.Style) {
	switch kind {
	case "running":
		return "●", accent
	case "error":
		return "✗", errText
	case "rejected":
		return "−", warnText
	case "waiting":
		return "…", warnText
	default:
		return "✓", okText
	}
}

func contentParts(raw json.RawMessage) []api.Part {
	_, parts := splitContent(raw)
	return parts
}

func splitContent(raw json.RawMessage) (string, []api.Part) {
	if len(raw) == 0 {
		return "", nil
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text, nil
	}
	var parts []api.Part
	if json.Unmarshal(raw, &parts) == nil {
		return "", parts
	}
	return string(raw), nil
}

func messageID(message api.Message) string {
	if message.MessageID != "" {
		return message.MessageID
	}
	if message.ID != "" {
		return message.ID
	}
	return message.Role
}

func parseTodos(raw json.RawMessage) []api.Todo {
	var items []api.Todo
	if json.Unmarshal(raw, &items) == nil {
		return items
	}
	return nil
}

func todosFromOutput(raw json.RawMessage) []api.Todo {
	var wrapped struct {
		Items []api.Todo `json:"items"`
		Value struct {
			Items []api.Todo `json:"items"`
		} `json:"value"`
	}
	if json.Unmarshal(raw, &wrapped) != nil {
		return nil
	}
	if len(wrapped.Value.Items) > 0 {
		return wrapped.Value.Items
	}
	return wrapped.Items
}

func parseUsage(raw json.RawMessage) usageSnap {
	var decoded struct {
		Input, Output, CacheRead, CacheWrite, Reasoning, Total int
		DurationMs, FirstTokenMs, FinishedAt                   int64
		InputTokens, OutputTokens                              int
		Provider, Model                                        string
	}
	if json.Unmarshal(raw, &decoded) != nil {
		return usageSnap{}
	}
	if decoded.Input == 0 {
		decoded.Input = decoded.InputTokens
	}
	if decoded.Output == 0 {
		decoded.Output = decoded.OutputTokens
	}
	if decoded.Total == 0 {
		decoded.Total = decoded.Input + decoded.Output
	}
	return usageSnap{
		Input: decoded.Input, Output: decoded.Output, CacheRead: decoded.CacheRead, CacheWrite: decoded.CacheWrite,
		Reasoning: decoded.Reasoning, Total: decoded.Total, DurationMs: decoded.DurationMs, FirstTokenMs: decoded.FirstTokenMs,
		FinishedAt: decoded.FinishedAt, Provider: decoded.Provider, Model: decoded.Model,
	}
}

func usageFromHistory(history []api.Message) usageSnap {
	for i := len(history) - 1; i >= 0; i-- {
		if history[i].Compact || history[i].Role != "assistant" {
			continue
		}
		if usage := parseUsage(history[i].Usage); usage.Input+usage.Output > 0 {
			return usage
		}
	}
	return usageSnap{}
}

func previewInput(raw json.RawMessage) string {
	var obj map[string]any
	if json.Unmarshal(raw, &obj) == nil {
		for _, key := range []string{"path", "command", "url", "regex", "query", "name", "description", "question", "from"} {
			if text, ok := obj[key].(string); ok && strings.TrimSpace(text) != "" {
				return oneLine(text, 80)
			}
		}
		return ""
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return oneLine(text, 80)
	}
	return ""
}

func durationText(d time.Duration) string {
	if d <= 0 {
		return ""
	}
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Milliseconds())
	}
	return fmt.Sprintf("%ds", int((d+500*time.Millisecond)/time.Second))
}

func oneLine(text string, max int) string {
	text = strings.Join(strings.Fields(text), " ")
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	if max < 2 {
		return ""
	}
	return string(runes[:max-1]) + "…"
}
