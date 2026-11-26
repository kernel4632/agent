/*
扩展呈现：按扩展在 manifest.json 里声明的 topbar 和 view，把工具结果或 /admin 返回值
格式化为终端可读文本；命令行和 TUI 浮层共用这一份渲染。

调用示例：
  line := render.FormatExtensionTopbar(bar, rawOutput)
  text := render.FormatExtensionView(cmd.View, data)
  status := render.ExtensionStatus(ext, true)
*/
package render

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"text/tabwriter"

	"github.com/kernel4632/agent/cli/internal/api"
)

// ExtensionStatus 生成扩展的一行状态文案，供 /extensions 浮层和 agent extensions list 共用。
func ExtensionStatus(item api.Extension, verbose bool) string {
	state := "未运行"
	switch {
	case item.Error != "":
		state = item.Error
	case !item.Enabled:
		state = "已关闭"
	case item.Running:
		state = "运行中"
	}
	if item.Changed && (verbose || item.Enabled) {
		if verbose {
			state += "（代码有更新，可 reload）"
		} else {
			state += " · 有更新"
		}
	}
	return state
}

// UnwrapToolOutput 拆开 AI SDK 工具输出外层的 { type, value } 包装。
func UnwrapToolOutput(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var decoded any
	if json.Unmarshal(raw, &decoded) != nil {
		return nil
	}
	if obj, ok := decoded.(map[string]any); ok {
		if kind, hasType := obj["type"].(string); hasType && kind != "" {
			if value, hasValue := obj["value"]; hasValue {
				return value
			}
		}
	}
	return decoded
}

// FormatExtensionTopbar 根据 cli.topbar 声明把工具输出渲染为顶部状态行；无条目时返回空字符串。
func FormatExtensionTopbar(bar api.ExtensionTopbar, raw json.RawMessage) string {
	value := UnwrapToolOutput(raw)
	items := sliceAt(value, bar.Items)
	if len(items) == 0 {
		return ""
	}
	done := 0
	current := ""
	for _, entry := range items {
		if bar.Count != nil && at(entry, bar.Count.Field) == bar.Count.Equals {
			done++
		}
		if current == "" && bar.Current != nil && at(entry, bar.Current.Field) == bar.Current.Equals {
			current = Sanitize(at(entry, bar.Current.Text))
		}
	}
	label := bar.Label
	if label == "" {
		label = bar.ID
	}
	text := fmt.Sprintf("%s %d/%d", label, done, len(items))
	if current != "" {
		text += " · " + current
	}
	return text
}

// FormatExtensionView 根据 cli.commands[].view 声明把数据格式化为可读文本；
// 未声明 view 时输出缩进 JSON（或原始字符串）。
func FormatExtensionView(view *api.ExtensionView, data any) string {
	if raw, ok := data.(json.RawMessage); ok {
		data = UnwrapToolOutput(raw)
	}
	if view == nil {
		if text, ok := data.(string); ok {
			return Sanitize(text)
		}
		return formatJSON(data)
	}
	switch view.Kind {
	case "checklist":
		return formatChecklist(view, data)
	case "list":
		return formatList(view, data)
	case "detail":
		return formatDetail(view, data)
	default:
		return formatJSON(data)
	}
}

func formatChecklist(view *api.ExtensionView, data any) string {
	var b strings.Builder
	if view.Title != "" {
		b.WriteString(view.Title + "\n\n")
	}
	items := sliceAt(data, view.Items)
	if len(items) == 0 {
		empty := view.Empty
		if empty == "" {
			empty = "没有条目。"
		}
		b.WriteString(empty)
		return strings.TrimRight(b.String(), "\n")
	}
	statusKey := view.Status
	if statusKey == "" {
		statusKey = "status"
	}
	textKey := view.Text
	if textKey == "" {
		textKey = "text"
	}
	done := 0
	for _, entry := range items {
		if at(entry, statusKey) == "completed" {
			done++
		}
	}
	if view.Progress != "" {
		b.WriteString(fmt.Sprintf("%s %d/%d\n\n", view.Progress, done, len(items)))
	}
	for _, entry := range items {
		mark := "·"
		switch at(entry, statusKey) {
		case "completed":
			mark = "✓"
		case "in_progress":
			mark = "▸"
		}
		b.WriteString(mark + " " + Sanitize(at(entry, textKey)) + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func formatList(view *api.ExtensionView, data any) string {
	var b strings.Builder
	if view.Title != "" {
		b.WriteString(view.Title + "\n\n")
	}
	items := sliceAt(data, view.Items)
	if len(items) == 0 {
		empty := view.Empty
		if empty == "" {
			empty = "没有数据。"
		}
		b.WriteString(empty)
		return strings.TrimRight(b.String(), "\n")
	}
	if len(view.Fields) == 0 {
		b.WriteString(formatJSON(items))
		return strings.TrimRight(b.String(), "\n")
	}
	var tableBuf bytes.Buffer
	tw := tabwriter.NewWriter(&tableBuf, 0, 4, 2, ' ', 0)
	headers := make([]string, len(view.Fields))
	for i, field := range view.Fields {
		label := field.Label
		if label == "" {
			label = field.Key
		}
		headers[i] = label
	}
	fmt.Fprintln(tw, strings.Join(headers, "\t"))
	for _, entry := range items {
		cols := make([]string, len(view.Fields))
		for i, field := range view.Fields {
			cols[i] = formatField(entry, field)
		}
		fmt.Fprintln(tw, strings.Join(cols, "\t"))
	}
	_ = tw.Flush()
	b.WriteString(tableBuf.String())
	return strings.TrimRight(b.String(), "\n")
}

func formatDetail(view *api.ExtensionView, data any) string {
	var b strings.Builder
	if view.Title != "" {
		b.WriteString(view.Title + "\n\n")
	}
	if data == nil {
		empty := view.Empty
		if empty == "" {
			empty = "没有内容。"
		}
		b.WriteString(empty)
		return strings.TrimRight(b.String(), "\n")
	}
	var meta []string
	for _, key := range view.Meta {
		if val := strings.TrimSpace(Sanitize(at(data, key))); val != "" {
			meta = append(meta, val)
		}
	}
	if len(meta) > 0 {
		b.WriteString(strings.Join(meta, " · ") + "\n\n")
	}
	body := ""
	if text, ok := data.(string); ok {
		body = text
	} else if view.Text != "" {
		body = at(data, view.Text)
	}
	if strings.TrimSpace(body) == "" && len(meta) == 0 {
		body = formatJSON(data)
	}
	b.WriteString(Sanitize(body))
	return strings.TrimRight(b.String(), "\n")
}

func formatField(entry any, field api.ExtensionViewField) string {
	raw, ok := lookup(entry, field.Key)
	if !ok || raw == nil {
		return "—"
	}
	if flag, isBool := raw.(bool); isBool && (field.True != "" || field.False != "") {
		if flag {
			return field.True
		}
		return field.False
	}
	text := strings.Join(strings.Fields(Sanitize(formatScalar(raw))), " ")
	if text == "" {
		return "—"
	}
	return text
}

func sliceAt(value any, path string) []any {
	target, ok := lookup(value, path)
	if !ok {
		return nil
	}
	items, _ := target.([]any)
	return items
}

func formatJSON(data any) string {
	encoded, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", data)
	}
	return string(encoded)
}
