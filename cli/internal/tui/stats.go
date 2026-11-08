package tui

import (
	"math"
	"strconv"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/kernel4632/agent/cli/internal/api"
	"github.com/kernel4632/agent/cli/internal/chat"
)

func (m *model) openStats() {
	m.rebuild()
	m.overlay = overlayState{kind: "stats"}
	m.focus = focusOverlay
	m.input.Blur()
	m.renderConversation(true)
}

func (m *model) speedText() string {
	if m.running {
		output := m.liveOutputTokens()
		if m.firstTokenAt > 0 && output > 0 {
			elapsed := time.Now().UnixMilli() - m.firstTokenAt
			if elapsed > 200 {
				return itoa(tokensPerSecond(output, elapsed)) + " tok/s"
			}
		}
		return ""
	}
	return speedOf(m.lastUsage)
}

func (m *model) liveOutputTokens() int {
	var b strings.Builder
	b.WriteString(m.liveText)
	b.WriteString(m.liveReasoning)
	b.WriteString(m.finalAnswer)
	for _, step := range m.steps {
		b.WriteString(step.text)
		if step.tool != nil {
			b.WriteString(step.tool.stream.String())
		}
	}
	return estimateTokens(b.String())
}

func speedOf(usage usageSnap) string {
	if usage.Output <= 0 {
		return ""
	}
	generation := usage.DurationMs
	if usage.FirstTokenMs > 0 && usage.DurationMs > usage.FirstTokenMs {
		generation = usage.DurationMs - usage.FirstTokenMs
	}
	if generation <= 0 {
		return ""
	}
	return itoa(tokensPerSecond(usage.Output, generation)) + " tok/s"
}

func tokensPerSecond(output int, elapsedMs int64) int {
	if output <= 0 || elapsedMs <= 0 {
		return 0
	}
	tps := int(math.Round(float64(output) * 1000 / float64(elapsedMs)))
	if tps < 1 {
		return 1
	}
	return tps
}

type usageReport struct {
	requests                                   []usageSnap
	input, output, cacheRead, cacheWrite       int
	reasoning, total                           int
	durationMs                                 int64
	contextUsed                                int
	contextApprox, usageApprox                 bool
	userTokens, thinkTokens, replyTokens, tool int
}

func (m *model) usageReport() usageReport {
	var report usageReport
	since := 0
	for i, message := range m.session.History {
		if message.Compact {
			since = i
		}
	}
	for _, message := range m.session.History {
		if message.Role != "assistant" && !message.Compact {
			continue
		}
		usage := parseUsage(message.Usage)
		if usage.Input+usage.Output == 0 {
			continue
		}
		if usage.Provider == "" {
			usage.Provider = m.session.Provider
		}
		if usage.Model == "" {
			usage.Model = m.session.Model
		}
		report.requests = append(report.requests, usage)
		report.input += usage.Input
		report.output += usage.Output
		report.cacheRead += usage.CacheRead
		report.cacheWrite += usage.CacheWrite
		report.reasoning += usage.Reasoning
		if usage.Total > 0 {
			report.total += usage.Total
		} else {
			report.total += usage.Input + usage.Output
		}
		report.durationMs += usage.DurationMs
	}
	report.userTokens, report.thinkTokens, report.replyTokens, report.tool = composition(m.session.History, since)
	if len(report.requests) == 0 {
		report.usageApprox = true
		report.input = report.userTokens + report.tool
		report.output = report.replyTokens + report.thinkTokens
		report.reasoning = report.thinkTokens
		report.total = report.input + report.output
	}
	for i := len(m.session.History) - 1; i >= 0; i-- {
		message := m.session.History[i]
		if message.Compact || message.Role != "assistant" {
			continue
		}
		if usage := parseUsage(message.Usage); usage.Input > 0 {
			report.contextUsed = usage.Input
			return report
		}
		break
	}
	report.contextApprox = true
	report.contextUsed = report.userTokens + report.thinkTokens + report.replyTokens + report.tool
	if report.contextUsed > 0 {
		report.contextUsed += 4000
	}
	return report
}

func composition(history []api.Message, since int) (user, thinking, reply, tools int) {
	if since < 0 {
		since = 0
	}
	for i := since; i < len(history); i++ {
		message := history[i]
		if message.Compact {
			continue
		}
		text, parts := splitContent(message.Content)
		if len(parts) == 0 {
			n := estimateTokens(text)
			if message.Role == "user" {
				user += n
			} else if message.Role != "tool" {
				reply += n
			}
			continue
		}
		for _, part := range parts {
			switch part.Type {
			case "text":
				n := estimateTokens(part.Text)
				if message.Role == "user" {
					user += n
				} else {
					reply += n
				}
			case "reasoning":
				n := estimateTokens(part.Text)
				thinking += n
			case "tool-call":
				tools += estimateTokens(string(part.Input))
			case "tool-result":
				tools += estimateTokens(chat.Output(part.Output))
			}
		}
	}
	return user, thinking, reply, tools
}

func estimateTokens(text string) int {
	if text == "" {
		return 0
	}
	cjk, other := 0, 0
	for _, r := range text {
		switch {
		case r == '\n' || r == '\r':
		case isCJK(r):
			cjk++
		default:
			other++
		}
	}
	num := cjk*12 + other*5
	if num == 0 {
		return 0
	}
	return (num + 17) / 18
}

func isCJK(r rune) bool {
	return (r >= 0x3400 && r <= 0x4DBF) ||
		(r >= 0x4E00 && r <= 0x9FFF) ||
		(r >= 0xF900 && r <= 0xFAFF) ||
		(r >= 0x3040 && r <= 0x30FF) ||
		(r >= 0xAC00 && r <= 0xD7AF)
}

func (m *model) statsText() string {
	report := m.usageReport()
	limit := m.contextLimit()
	var b strings.Builder
	b.WriteString("用量\n")
	modelName := strings.Trim(m.session.Provider+"/"+m.session.Model, "/")
	if modelName != "" {
		b.WriteString(modelName + "\n")
	}
	if report.contextApprox || report.usageApprox {
		b.WriteString("缺少请求记录的部分按字数估算，标了「估算」。\n")
	}
	b.WriteString("\n上下文\n")
	used := report.contextUsed
	if limit > 0 && used > 0 {
		percent := used * 100 / limit
		label := itoa(percent) + "%"
		if percent == 0 {
			label = "<1%"
		}
		if report.contextApprox {
			label = "~" + label
		}
		b.WriteString("  " + label + "\n")
		b.WriteString("  " + meter(percent, 24) + "\n")
	}
	b.WriteString("  " + formatTokens(used))
	if limit > 0 {
		b.WriteString(" / " + formatTokens(limit))
		if used > limit {
			b.WriteString("    超出 " + formatTokens(used-limit))
		} else {
			b.WriteString("    剩余 " + formatTokens(limit-used))
		}
	}
	b.WriteByte('\n')
	if m.config.Compact.Threshold > 0 {
		b.WriteString("  自动压缩 " + itoa(int(m.config.Compact.Threshold*100)) + "%\n")
	}

	b.WriteString("\nToken\n")
	if report.total == 0 && report.input+report.output == 0 {
		b.WriteString("  这个会话还没有可统计的用量。\n")
	} else {
		b.WriteString("  合计 " + formatTokens(report.total))
		if report.usageApprox {
			b.WriteString("  估算")
		}
		b.WriteByte('\n')
		b.WriteString("  输入 " + formatTokens(report.input) + "\n")
		b.WriteString("  输出 " + formatTokens(report.output) + "\n")
		if !report.usageApprox {
			b.WriteString("  缓存命中 " + cacheHit(report.input, report.cacheRead) + "%\n")
			b.WriteString("  缓存读取 " + formatTokens(min(report.input, report.cacheRead)) + "\n")
			b.WriteString("  未缓存输入 " + formatTokens(max(0, report.input-report.cacheRead)) + "\n")
			if report.cacheWrite > 0 {
				b.WriteString("  缓存写入 " + formatTokens(report.cacheWrite) + "\n")
			}
		}
		if report.reasoning > 0 {
			b.WriteString("  思考 " + formatTokens(report.reasoning) + "\n")
		}
		if n := len(report.requests); n > 0 {
			b.WriteString("  请求 " + itoa(n) + " 次")
			if report.durationMs > 0 {
				b.WriteString("    累计 " + formatDurationMs(report.durationMs))
			}
			b.WriteByte('\n')
		}
	}

	if sum := report.userTokens + report.thinkTokens + report.replyTokens + report.tool; sum > 0 {
		b.WriteString("\n构成  估算\n")
		b.WriteString("  你的消息 " + formatTokens(report.userTokens) + "\n")
		b.WriteString("  思考 " + formatTokens(report.thinkTokens) + "\n")
		b.WriteString("  回复 " + formatTokens(report.replyTokens) + "\n")
		b.WriteString("  工具 " + formatTokens(report.tool) + "\n")
	}

	b.WriteString("\n速度\n")
	if live := m.speedText(); m.running && live != "" {
		b.WriteString("  正在生成  " + live + "\n")
	}
	groups := speedGroups(report.requests)
	if len(groups) == 0 {
		if !m.running {
			b.WriteString("  还没有足够的请求耗时。\n")
		}
	} else {
		b.WriteString("  模型                    首字      速度\n")
		shown := groups
		if len(shown) > 5 {
			shown = shown[:5]
		}
		for _, group := range shown {
			name := strings.Trim(group.provider+"/"+group.model, "/")
			if name == "" {
				name = "未知模型"
			}
			b.WriteString("  " + padWidth(name, 22) + "  " + padWidth(formatDurationMs(group.lastFirst), 8) + "  " + speedLabel(group.lastTps) + "\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

type speedRow struct {
	provider, model string
	lastFirst       int64
	lastTps         int
	lastAt          int64
}

func speedGroups(requests []usageSnap) []speedRow {
	order := []string{}
	groups := map[string]*speedRow{}
	for _, usage := range requests {
		key := usage.Provider + "\x00" + usage.Model
		group := groups[key]
		if group == nil {
			group = &speedRow{provider: usage.Provider, model: usage.Model}
			groups[key] = group
			order = append(order, key)
		}
		group.lastFirst = usage.FirstTokenMs
		group.lastTps = 0
		if speed := speedOf(usage); speed != "" {
			group.lastTps = tokensPerSecond(usage.Output, generationMs(usage))
		}
		group.lastAt = usage.FinishedAt
	}
	rows := make([]speedRow, 0, len(order))
	for _, key := range order {
		rows = append(rows, *groups[key])
	}
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0 && rows[j].lastAt > rows[j-1].lastAt; j-- {
			rows[j], rows[j-1] = rows[j-1], rows[j]
		}
	}
	return rows
}

func speedLabel(tps int) string {
	if tps <= 0 {
		return "—"
	}
	return itoa(tps) + " tok/s"
}

func generationMs(usage usageSnap) int64 {
	if usage.FirstTokenMs > 0 && usage.DurationMs > usage.FirstTokenMs {
		return usage.DurationMs - usage.FirstTokenMs
	}
	return usage.DurationMs
}

func (m *model) click(msg tea.MouseClickMsg) (tea.Cmd, bool) {
	if msg.Button != tea.MouseLeft || m.overlay.kind != "" {
		return nil, false
	}
	if m.height > 0 && msg.Y == m.height-1 && m.statsWidth > 0 && msg.X < m.statsWidth {
		m.openStats()
		return nil, true
	}
	if m.frameVP <= 0 || msg.Y < m.frameTop || msg.Y >= m.frameTop+m.frameVP {
		return nil, false
	}
	line := m.viewport.YOffset() + (msg.Y - m.frameTop)
	for _, span := range m.spans {
		if line < span.start || line >= span.end || span.index < 0 || span.index >= len(m.blocks) {
			continue
		}
		item := m.blocks[span.index]
		switch item.kind {
		case "tool", "reasoning", "compact":
		default:
			return nil, true
		}
		m.focus = focusTranscript
		m.input.Blur()
		m.selected = span.index
		m.selectedID = item.id
		m.open[item.id] = !m.blockOpen(item)
		m.renderConversation(false)
		return nil, true
	}
	return nil, false
}

func formatTokens(n int) string {
	if n < 0 {
		n = 0
	}
	switch {
	case n >= 1_000_000_000:
		return trimFloat(float64(n)/1_000_000_000) + "B"
	case n >= 1_000_000:
		return trimFloat(float64(n)/1_000_000) + "M"
	case n >= 1000:
		return trimFloat(float64(n)/1000) + "K"
	default:
		return itoa(n)
	}
}

func trimFloat(value float64) string {
	return strings.TrimSuffix(strconv.FormatFloat(value, 'f', 1, 64), ".0")
}

func cacheHit(input, cache int) string {
	if input <= 0 || cache <= 0 {
		return "0"
	}
	if cache >= input {
		return "100"
	}
	tenths := cache * 1000 / input
	if tenths%10 == 0 {
		return itoa(tenths / 10)
	}
	return itoa(tenths/10) + "." + itoa(tenths%10)
}

func formatDurationMs(ms int64) string {
	if ms <= 0 {
		return "—"
	}
	if ms < 1000 {
		return itoa(int(ms)) + "ms"
	}
	if ms < 60_000 {
		tenths := (ms + 50) / 100
		return itoa(int(tenths/10)) + "." + itoa(int(tenths%10)) + "s"
	}
	return itoa(int(ms/60_000)) + "m" + itoa(int((ms%60_000)/1000)) + "s"
}

func meter(percent, width int) string {
	if width < 4 {
		width = 4
	}
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	filled := percent * width / 100
	if percent > 0 && filled == 0 {
		filled = 1 // 不到一格也留一格，否则 9% 在 8 格的底栏上会画成全空
	}
	return strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
}

func padWidth(text string, width int) string {
	if lipgloss.Width(text) > width {
		head, _ := cutWidth(text, max(1, width-1))
		return head + "…"
	}
	return text + strings.Repeat(" ", width-lipgloss.Width(text))
}
