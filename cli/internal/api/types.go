// Package api implements the current Agent HTTP and SSE contract.
package api

import "encoding/json"

type Session struct {
	ID          string                `json:"id"`
	Title       string                `json:"title"`
	Cwd         string                `json:"cwd"`
	Provider    string                `json:"provider"`
	Model       string                `json:"model"`
	Running     bool                  `json:"running"`
	History     []Message             `json:"history"`
	Pending     []Permission          `json:"pending"`
	Settings    Settings              `json:"settings"`
	CreatedAt   int64                 `json:"createdAt"`
	UpdatedAt   int64                 `json:"updatedAt"`
	Todos       json.RawMessage       `json:"todos,omitempty"`
	Undoable    int                   `json:"undoable"`
	ToolTimings map[string]ToolTiming `json:"toolTimings,omitempty"`
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
	Compact   bool            `json:"compact,omitempty"`
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
	Raw          json.RawMessage `json:"-"`
	Type         string          `json:"type"`
	Request      json.RawMessage `json:"request"`
	Text         string          `json:"text"`
	Error        json.RawMessage `json:"error"`
	ErrorText    string          `json:"errorText"`
	Reason       string          `json:"reason"`
	ToolCallID   string          `json:"toolCallId"`
	ToolName     string          `json:"toolName"`
	CallID       string          `json:"callID"`
	Tool         string          `json:"tool"`
	Input        json.RawMessage `json:"input"`
	Output       json.RawMessage `json:"output"`
	Data         json.RawMessage `json:"data"`
	Usage        json.RawMessage `json:"usage"`
	Title        string          `json:"title"`
	StartedAt    int64           `json:"startedAt"`
	FinishedAt   int64           `json:"finishedAt"`
	DurationMs   int64           `json:"durationMs"`
	FirstTokenAt int64           `json:"firstTokenAt"`
	FirstTokenMs int64           `json:"firstTokenMs"`
	Provider     string          `json:"provider"`
	Model        string          `json:"model"`
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

// Core tags compaction with a string; regular SDK events may use an object.
func (e Event) IsCompact() bool {
	return string(e.Request) == `"compact"`
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
			ID      string `json:"id"`
			Name    string `json:"name"`
			Context int    `json:"context"`
		} `json:"models"`
	} `json:"providers"`
	Compact struct {
		Threshold float64 `json:"threshold"`
	} `json:"compact"`
}

type ToolTiming struct {
	StartedAt  int64 `json:"startedAt"`
	FinishedAt int64 `json:"finishedAt"`
	DurationMs int64 `json:"durationMs"`
}

type Tool struct {
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	KindLabel  string `json:"kindLabel"`
	Permission string `json:"permission"`
	UI         struct {
		Title   string `json:"title"`
		Summary string `json:"summary"`
		Icon    string `json:"icon"`
	} `json:"ui"`
}

type Todo struct {
	Text   string `json:"text"`
	Status string `json:"status"`
}

type FileChange struct {
	Path    string `json:"path"`
	Before  string `json:"before"`
	After   string `json:"after"`
	Added   bool   `json:"added"`
	Deleted bool   `json:"deleted"`
}

type RollbackPreview struct {
	Messages  int          `json:"messages"`
	ToolCalls []string     `json:"toolCalls"`
	Files     []FileChange `json:"files"`
}

type Health struct {
	OK              bool   `json:"ok"`
	Version         string `json:"version"`
	TargetVersion   string `json:"targetVersion"`
	RestartRequired bool   `json:"restartRequired"`
	Sessions        int    `json:"sessions"`
	Running         int    `json:"running"`
}

// MCPServer is the settings list item. Env and headers are not decoded, so a
// JSON listing cannot echo credentials that live in the raw definition.
type MCPServer struct {
	Name       string `json:"name"`
	Enabled    bool   `json:"enabled"`
	Error      string `json:"error,omitempty"`
	Definition struct {
		Command   string   `json:"command,omitempty"`
		Args      []string `json:"args,omitempty"`
		URL       string   `json:"url,omitempty"`
		Transport string   `json:"transport,omitempty"`
	} `json:"definition"`
}

type MCPDetected struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	App        string `json:"app"`
	Configured bool   `json:"configured"`
}

type MCPCatalog struct {
	Servers  []MCPServer `json:"servers"`
	Detected struct {
		Servers []MCPDetected `json:"servers"`
	} `json:"detected"`
}

type Skill struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	SourceLabel string `json:"sourceLabel"`
	Scope       string `json:"scope"`
}

type Directory struct {
	Current string  `json:"current"`
	Parent  *string `json:"parent"`
	Entries []struct {
		Name string `json:"name"`
		Path string `json:"path"`
		Type string `json:"type"`
	} `json:"entries"`
}
