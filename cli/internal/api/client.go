/*
HTTP 客户端：统一处理 JSON 请求、错误响应和压缩这种长等待接口。

普通接口使用短超时，避免服务不可达时终端一直挂住；压缩要等模型生成完整总结，
单独放宽响应头和总超时，同时保留调用方 Ctrl+C 的取消。

调用示例：

	client, err := New("http://127.0.0.1:3000")
	err = client.Request(ctx, "GET", "/health", nil, &health)
	err = client.Compact(ctx, sessionID, &summary)
*/
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// 压缩是一次真实的模型请求；服务端要等模型生成完才返回响应头，不能被普通
// 20 秒响应头超时或 60 秒总超时截断。调用方仍可用 Ctrl+C 取消。
const compactTimeout = 10 * time.Minute

type Client struct {
	base string
	http *http.Client
}

type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string { return fmt.Sprintf("HTTP %d: %s", e.Status, e.Message) }

func New(address string) (*Client, error) {
	u, err := url.Parse(address)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return nil, fmt.Errorf("服务地址须为 HTTP(S) URL，例如 http://127.0.0.1:3000")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 20 * time.Second
	return &Client{base: strings.TrimRight(address, "/"), http: &http.Client{Transport: transport}}, nil
}

// Request 发普通 JSON 接口；响应头超时 20 秒、总超时 60 秒。
func (c *Client) Request(ctx context.Context, method, path string, body, result any) error {
	return c.request(ctx, method, path, body, result, 60*time.Second)
}

// Admin 调管理总线：设置页和能力页的动作全部走 POST /admin，body 里带 op。
type AdminArgs map[string]any

// SplitArgs 按空白与可选的单/双引号切分命令参数，不经过 shell 转义。
// `/model` 和扩展命令的位置参数共用这一份切分，保留路径斜杠与空格。
func SplitArgs(argument string) ([]string, error) {
	var fields []string
	var word strings.Builder
	var quote rune
	started := false
	for _, ch := range argument {
		if quote != 0 {
			if ch == quote {
				quote = 0
			} else {
				word.WriteRune(ch)
			}
		} else if ch == '"' || ch == '\'' {
			quote, started = ch, true
		} else if unicode.IsSpace(ch) {
			if started {
				fields = append(fields, word.String())
				word.Reset()
				started = false
			}
		} else {
			word.WriteRune(ch)
			started = true
		}
	}
	if quote != 0 {
		return nil, fmt.Errorf("名称引号未闭合")
	}
	if started {
		fields = append(fields, word.String())
	}
	return fields, nil
}

// ParseBoolArg 把常见的开关文本转成布尔值。
func ParseBoolArg(value string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "on", "true", "enable", "enabled", "1":
		return true, nil
	case "off", "false", "disable", "disabled", "0":
		return false, nil
	default:
		return false, fmt.Errorf("必须是 on 或 off")
	}
}

// ParseScalarArg 把 --arg 的字符串值尽可能还原为布尔、数字或 JSON 对象，避免布尔参数被当成非空字符串。
func ParseScalarArg(value string) any {
	trimmed := strings.TrimSpace(value)
	switch trimmed {
	case "true":
		return true
	case "false":
		return false
	}
	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
		var decoded any
		if json.Unmarshal([]byte(trimmed), &decoded) == nil {
			return decoded
		}
	}
	if trimmed != "" && !strings.HasPrefix(trimmed, "0") && !strings.HasPrefix(trimmed, "-0") {
		if n, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
			return n
		}
	}
	if strings.Contains(trimmed, ".") {
		if f, err := strconv.ParseFloat(trimmed, 64); err == nil {
			return f
		}
	}
	return value
}

// ExtensionBody 按扩展声明拼一条命令的请求体：声明里的固定 args 打底，
// 再并入 sessionId / cwd、位置参数（params）或整段输入（input）。
func ExtensionBody(decl ExtensionCommand, sessionID, cwd, argument string) (map[string]any, error) {
	body := map[string]any{}
	for key, value := range decl.Args {
		body[key] = value
	}
	if !decl.NoSession && sessionID != "" {
		body["sessionId"] = sessionID
	}
	if decl.Cwd && cwd != "" {
		body["cwd"] = cwd
	}
	argument = strings.TrimSpace(argument)
	if len(decl.Params) > 0 {
		if argument == "" {
			return body, nil
		}
		fields, err := SplitArgs(argument)
		if err != nil {
			return nil, err
		}
		if len(fields) > len(decl.Params) {
			return nil, fmt.Errorf("参数过多，用法: %s", decl.Usage)
		}
		for i, raw := range fields {
			field, kind, _ := strings.Cut(decl.Params[i], ":")
			switch kind {
			case "bool":
				flag, err := ParseBoolArg(raw)
				if err != nil {
					return nil, fmt.Errorf("%s %w", field, err)
				}
				body[field] = flag
			case "int":
				n, err := strconv.Atoi(raw)
				if err != nil {
					return nil, fmt.Errorf("%s 必须是整数", field)
				}
				body[field] = n
			case "number":
				n, err := strconv.ParseFloat(raw, 64)
				if err != nil {
					return nil, fmt.Errorf("%s 必须是数字", field)
				}
				body[field] = n
			default:
				body[field] = raw
			}
		}
		return body, nil
	}
	if argument != "" && decl.Input != "" {
		body[decl.Input] = argument
	} else if argument != "" {
		return nil, fmt.Errorf("/%s 不接受参数", decl.Name)
	}
	return body, nil
}

func (c *Client) Admin(ctx context.Context, op string, args AdminArgs, result any) error {
	body := make(map[string]any, len(args)+1)
	for key, value := range args {
		body[key] = value
	}
	body["op"] = op
	return c.Request(ctx, "POST", "/admin", body, result)
}

// Compact 发手动压缩请求。压缩在服务端要等模型生成总结后才返回响应头，
// 所以单独去掉响应头超时，并把总时限放宽到 compactTimeout；ctx 取消仍生效。
func (c *Client) Compact(ctx context.Context, id string, result any) error {
	transport := c.http.Transport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 0
	defer transport.CloseIdleConnections()
	client := &Client{base: c.base, http: &http.Client{Transport: transport}}
	return client.request(ctx, "POST", SessionPath("compact", id), nil, result, compactTimeout)
}

func (c *Client) request(ctx context.Context, method, path string, body, result any, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var data io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		data = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, data)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("连接 %s 失败: %w", c.base, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return responseError(resp)
	}
	if result == nil {
		_, err = io.Copy(io.Discard, resp.Body)
		return err
	}
	if err := json.NewDecoder(resp.Body).Decode(result); err != nil {
		return fmt.Errorf("%s 返回的 JSON 无法解析: %w", path, err)
	}
	return nil
}

func responseError(resp *http.Response) error {
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	var info struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(data, &info)
	if info.Error == "" {
		info.Error = resp.Status
	}
	return &HTTPError{Status: resp.StatusCode, Message: info.Error}
}

func SessionPath(action, id string) string { return "/session/" + action + "/" + url.PathEscape(id) }
func AgentPath(action, id string) string   { return "/agent/" + action + "/" + url.PathEscape(id) }

func (c *Client) Session(ctx context.Context, id string) (Session, error) {
	var session Session
	err := c.Request(ctx, "GET", SessionPath("read", id), nil, &session)
	return session, err
}

func (c *Client) Decide(ctx context.Context, id, callID, decision string) error {
	var result struct {
		OK bool `json:"ok"`
	}
	err := c.Request(ctx, "POST", AgentPath("decide", id), map[string]string{"toolCallId": callID, "decision": decision}, &result)
	if err != nil {
		return err
	}
	if !result.OK {
		return fmt.Errorf("审批 %s 已失效，请重新读取会话", callID)
	}
	return nil
}

func (c *Client) Stop(ctx context.Context, id, content, reasoning string) error {
	return c.Request(ctx, "POST", AgentPath("stop", id), map[string]any{
		"partial": map[string]string{"content": content, "reasoning": reasoning},
	}, nil)
}

func (c *Client) Subscribe(ctx context.Context, id string) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.base+"/sse/connect/"+url.PathEscape(id), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "text/event-stream")
	// Event IDs reset after every history save. Never send Last-Event-ID.
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		return nil, responseError(resp)
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		resp.Body.Close()
		return nil, fmt.Errorf("服务未返回 SSE，请检查 --server 地址")
	}
	return resp.Body, nil
}
