// Package chat coordinates a run and renders the project's message types.
package chat

import (
	"encoding/json"
	"strings"
	"unicode"

	"github.com/kernel4632/agent/cli/internal/api"
)

// Plain keeps model/tool output from injecting terminal control sequences.
func Plain(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || !unicode.IsControl(r) {
			return r
		}
		return -1
	}, s)
}

func Output(data json.RawMessage) string {
	var text string
	if json.Unmarshal(data, &text) == nil {
		return text
	}
	var output struct {
		Type   string          `json:"type"`
		Value  json.RawMessage `json:"value"`
		Reason string          `json:"reason"`
	}
	if json.Unmarshal(data, &output) != nil {
		return string(data)
	}
	if output.Reason != "" {
		return output.Reason
	}
	if json.Unmarshal(output.Value, &text) == nil {
		return text
	}
	if len(output.Value) > 0 {
		return string(output.Value)
	}
	return string(data)
}

func ControlAnswer(name string, input json.RawMessage) string {
	var values struct {
		Result   string `json:"result"`
		Question string `json:"question"`
	}
	_ = json.Unmarshal(input, &values)
	switch name {
	case "attempt_completion":
		return values.Result
	case "ask_followup_question":
		return values.Question
	}
	return ""
}

func MessageText(message api.Message, reasoning bool) string {
	var text string
	if json.Unmarshal(message.Content, &text) == nil {
		return text
	}
	var parts []api.Part
	_ = json.Unmarshal(message.Content, &parts)
	var lines []string
	for _, part := range parts {
		switch part.Type {
		case "text":
			lines = append(lines, part.Text)
		case "reasoning":
			if reasoning {
				lines = append(lines, "[思考] "+part.Text)
			}
		case "tool-call":
			if answer := ControlAnswer(part.ToolName, part.Input); answer != "" {
				lines = append(lines, answer)
			}
		}
	}
	return strings.Join(lines, "\n")
}
