/*
工具行呈现：按工具声明的 UI 模板把参数淡化成一句摘要，并判断结果是好是坏。

调用示例：
  summary := render.Apply(ui.Summary, input)
  label, kind := render.Outcome(output, running)
*/
package render

import (
	"encoding/json"
	"strconv"
	"strings"
)

// Apply fills {path} markers in a tool summary. Paths can walk objects and
// arrays, for example patches.0.path. Missing values become empty.
func Apply(template string, input json.RawMessage) string {
	if strings.TrimSpace(template) == "" {
		return ""
	}
	var value any
	if len(input) > 0 && json.Unmarshal(input, &value) != nil {
		return ""
	}
	var b strings.Builder
	rest := template
	for {
		open := strings.IndexByte(rest, '{')
		if open < 0 {
			b.WriteString(rest)
			break
		}
		close := strings.IndexByte(rest[open:], '}')
		if close < 0 {
			b.WriteString(rest)
			break
		}
		b.WriteString(rest[:open])
		b.WriteString(at(value, rest[open+1:open+close]))
		rest = rest[open+close+1:]
	}
	return strings.TrimSpace(b.String())
}

func at(value any, path string) string {
	current, ok := lookup(value, path)
	if !ok {
		return ""
	}
	return formatScalar(current)
}

func lookup(value any, path string) (any, bool) {
	if strings.TrimSpace(path) == "" {
		return value, value != nil
	}
	current := value
	for _, key := range strings.Split(path, ".") {
		if key == "" {
			return nil, false
		}
		switch node := current.(type) {
		case map[string]any:
			next, ok := node[key]
			if !ok {
				return nil, false
			}
			current = next
		case []any:
			index, err := strconv.Atoi(key)
			if err != nil || index < 0 || index >= len(node) {
				return nil, false
			}
			current = node[index]
		default:
			return nil, false
		}
	}
	return current, true
}

func formatScalar(current any) string {
	switch item := current.(type) {
	case nil:
		return ""
	case string:
		return item
	case float64:
		if item == float64(int64(item)) {
			return strconv.FormatInt(int64(item), 10)
		}
		return strconv.FormatFloat(item, 'f', -1, 64)
	case int:
		return strconv.Itoa(item)
	case int64:
		return strconv.FormatInt(item, 10)
	case bool:
		return strconv.FormatBool(item)
	default:
		encoded, err := json.Marshal(item)
		if err != nil {
			return ""
		}
		return string(encoded)
	}
}

// Outcome classifies a tool result the same way the web client does.
func Outcome(output json.RawMessage, running bool) (label, kind string) {
	if running {
		return "正在执行", "running"
	}
	var wrapped struct {
		Type   string `json:"type"`
		Reason string `json:"reason"`
	}
	if len(output) > 0 && json.Unmarshal(output, &wrapped) == nil {
		switch wrapped.Type {
		case "execution-denied":
			return "已拒绝", "rejected"
		case "error-text", "error-json":
			return "失败", "error"
		}
	}
	if len(output) == 0 || string(output) == "null" {
		return "等待结果", "waiting"
	}
	return "已完成", "completed"
}
