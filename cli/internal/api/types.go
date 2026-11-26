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

// ExtensionViewField 描述列表视图里的一列字段。
type ExtensionViewField struct {
	Key   string `json:"key"`
	Label string `json:"label,omitempty"`
	True  string `json:"true,omitempty"`
	False string `json:"false,omitempty"`
}

// ExtensionView 描述扩展命令结果的可读渲染方式（checklist / list / detail），
// 供 TUI 浮层和 agent extensions call 文本输出共用。
type ExtensionView struct {
	Kind     string               `json:"kind"`
	Title    string               `json:"title,omitempty"`
	Empty    string               `json:"empty,omitempty"`
	Items    string               `json:"items,omitempty"`
	Text     string               `json:"text,omitempty"`
	Status   string               `json:"status,omitempty"`
	Progress string               `json:"progress,omitempty"`
	Meta     []string             `json:"meta,omitempty"`
	Fields   []ExtensionViewField `json:"fields,omitempty"`
}

type ExtensionTopbarCount struct {
	Field  string `json:"field"`
	Equals string `json:"equals"`
}

type ExtensionTopbarCurrent struct {
	Field  string `json:"field"`
	Equals string `json:"equals"`
	Text   string `json:"text"`
}

// ExtensionTopbar 描述扩展挂到 TUI 顶部的状态条（对标网页端 app.topbar.add）。
type ExtensionTopbar struct {
	ID      string                  `json:"id"`
	Tool    string                  `json:"tool"`
	Items   string                  `json:"items,omitempty"`
	Label   string                  `json:"label,omitempty"`
	Count   *ExtensionTopbarCount   `json:"count,omitempty"`
	Current *ExtensionTopbarCurrent `json:"current,omitempty"`
}

// ExtensionCommand 是扩展在 manifest.json 的 cli.commands 里声明的一条 CLI 命令：
// CLI 不执行扩展代码，只按声明把斜杠命令/快捷键接到工具输出或 /admin 的动作上。
type ExtensionCommand struct {
	Name      string         `json:"name"`
	Hint      string         `json:"hint"`
	Usage     string         `json:"usage"`
	Shortcut  string         `json:"shortcut,omitempty"`
	Op        string         `json:"op,omitempty"`
	Tool      string         `json:"tool,omitempty"`
	Args      map[string]any `json:"args,omitempty"`
	Params    []string       `json:"params,omitempty"`
	Input     string         `json:"input,omitempty"`
	NoSession bool           `json:"noSession,omitempty"`
	Cwd       bool           `json:"cwd,omitempty"`
	View      *ExtensionView `json:"view,omitempty"`
}

type ExtensionCli struct {
	Topbar   []ExtensionTopbar  `json:"topbar,omitempty"`
	Commands []ExtensionCommand `json:"commands,omitempty"`
}

type Extension struct {
	Name        string       `json:"name"`
	Title       string       `json:"title"`
	Description string       `json:"description"`
	Version     string       `json:"version"`
	Source      string       `json:"source"`
	Enabled     bool         `json:"enabled"`
	Running     bool         `json:"running"`
	Requires    []string     `json:"requires"`
	Dependents  []string     `json:"dependents"`
	HasFrontend bool         `json:"hasFrontend"`
	Changed     bool         `json:"changed"`
	Error       string       `json:"error"`
	Cli         ExtensionCli `json:"cli"`
}

type ExtensionState struct {
	Extensions []Extension `json:"extensions"`
	Loaded     []string    `json:"loaded"`
	Changed    []string    `json:"changed"`
}

// SessionList 是 /session/list 的响应：列表和分组一起返回（分组只是显示顺序）。
type SessionList struct {
	Sessions []Session `json:"sessions"`
	Groups   []any     `json:"groups"`
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
