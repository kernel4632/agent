package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

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

func (c *Client) Request(ctx context.Context, method, path string, body, result any) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
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
