// Package api implements the current Agent HTTP and SSE contract.
package api

import "encoding/json"

type Session struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	Cwd       string          `json:"cwd"`
	Provider  string          `json:"provider"`
	Model     string          `json:"model"`
	Running   bool            `json:"running"`
	History   []Message       `json:"history"`
	Pending   []Permission    `json:"pending"`
	Settings  Settings        `json:"settings"`
	CreatedAt int64           `json:"createdAt"`
	UpdatedAt int64           `json:"updatedAt"`
	Todos     json.RawMessage `json:"todos,omitempty"`
	Undoable  int             `json:"undoable"`
}

type Settings struct {
	Reasoning string `json:"reasoning"`
}

type Message struct {
	ID        string          `json:"id"`
	MessageID string          `json:"messageId"`
	Role      string          `json:"role"`
	Content   json.RawMessage `json:"content"`
	Usage     json.RawMessage `json:"usage,omitempty"`
}

type Part struct {
	Type       string          `json:"type"`
	Text       string          `json:"text"`
	ToolName   string          `json:"toolName"`
	ToolCallID string          `json:"toolCallId"`
	Input      json.RawMessage `json:"input"`
	Output     json.RawMessage `json:"output"`
}

type Permission struct {
	CallID string          `json:"callID"`
	Tool   string          `json:"tool"`
	Input  json.RawMessage `json:"input"`
}

// The server uses callID/tool for permissions and toolCallId/toolName for tools.
type Event struct {
	Raw        json.RawMessage `json:"-"`
	Type       string          `json:"type"`
	Text       string          `json:"text"`
	Error      json.RawMessage `json:"error"`
	ErrorText  string          `json:"errorText"`
	Reason     string          `json:"reason"`
	ToolCallID string          `json:"toolCallId"`
	ToolName   string          `json:"toolName"`
	CallID     string          `json:"callID"`
	Tool       string          `json:"tool"`
	Input      json.RawMessage `json:"input"`
	Output     json.RawMessage `json:"output"`
	Data       json.RawMessage `json:"data"`
	Usage      json.RawMessage `json:"usage"`
	Title      string          `json:"title"`
}

// Keep unknown event fields in NDJSON (retry details, subtask IDs, tool output
// metadata, etc.) while exposing typed fields for the terminal renderer.
func (e *Event) UnmarshalJSON(data []byte) error {
	type fields Event
	if err := json.Unmarshal(data, (*fields)(e)); err != nil {
		return err
	}
	e.Raw = append(e.Raw[:0], data...)
	return nil
}

func (e Event) MarshalJSON() ([]byte, error) {
	if len(e.Raw) > 0 {
		return e.Raw, nil
	}
	type fields Event
	return json.Marshal(fields(e))
}

func (e Event) Failure() string {
	if e.ErrorText != "" {
		return e.ErrorText
	}
	if len(e.Error) == 0 || string(e.Error) == "null" {
		return ""
	}
	var text string
	if json.Unmarshal(e.Error, &text) == nil {
		return text
	}
	var info struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(e.Error, &info) == nil && info.Message != "" {
		return info.Message
	}
	return string(e.Error)
}

type Config struct {
	Providers []struct {
		Name    string `json:"name"`
		Enabled *bool  `json:"enabled"`
		Models  []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"models"`
	} `json:"providers"`
}
