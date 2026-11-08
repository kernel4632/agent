package chat

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/kernel4632/agent/cli/internal/api"
)

var ErrPending = errors.New("工具正在等待审批")

type Hooks struct {
	Event      func(api.Event)
	Snapshot   func(api.Session)
	Permission func(context.Context, api.Permission) error
	// Stream 拿到当前这一路订阅的取消函数。取消它只会重连，不会停止服务端任务。
	Stream func(context.CancelFunc)
}

type packet struct {
	event api.Event
	err   error
}

// Run starts subscribing alongside the send (Bun may defer SSE headers until
// the first event), filters cached terminal events, and reads history on reconnect.
// Sending is never retried. Cancelling the parent context stops the run and
// persists the unfinished model response. Cancelling only the stream from
// Hooks.Stream reconnects and leaves the server task running.
func Run(ctx context.Context, client *api.Client, initial api.Session, action, input string, hooks Hooks) (err error) {
	var content, reasoning string
	started := action == "watch"
	defer func() {
		if ctx.Err() != nil && started {
			stopCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			if stopErr := client.Stop(stopCtx, initial.ID, content, reasoning); stopErr != nil {
				err = fmt.Errorf("已取消本地等待，但停止服务端任务失败: %w", stopErr)
			}
		}
	}()
	seen := map[string]bool{}
	approve := func(p api.Permission) error {
		if seen[p.CallID] {
			return nil
		}
		seen[p.CallID] = true
		if hooks.Permission == nil {
			return ErrPending
		}
		if err := hooks.Permission(ctx, p); err != nil {
			return &permissionFailure{err}
		}
		return nil
	}
	snapshot := initial
	for attempt := 0; attempt < 4; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if attempt > 0 {
			if hooks.Event != nil {
				hooks.Event(api.Event{Type: "reconnecting"})
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt) * 300 * time.Millisecond):
			}
			snapshot, err = client.Session(ctx, initial.ID)
			if err != nil {
				continue
			}
			content, reasoning = "", ""
			if hooks.Snapshot != nil {
				hooks.Snapshot(snapshot)
			}
			// Even an idle snapshot may still have a cached agent-finish error.
		}
		streamCtx, closeStream := context.WithCancel(ctx)
		if hooks.Stream != nil {
			hooks.Stream(closeStream) // 界面回来时只取消这一路，让循环重新读历史再订
		}
		packets := make(chan packet, 64)
		go func() {
			body, connectErr := client.Subscribe(streamCtx, initial.ID)
			if connectErr != nil {
				select {
				case packets <- packet{err: connectErr}:
				case <-ctx.Done(): // 父任务还在时也要把错误交出去，否则没人醒来
				}
				return
			}
			defer body.Close()
			err := api.ReadEvents(body, func(event api.Event) error {
				select {
				case packets <- packet{event: event}:
					return nil
				case <-streamCtx.Done():
					return streamCtx.Err()
				}
			})
			select {
			case packets <- packet{err: err}:
			case <-ctx.Done():
			}
		}()
		if !started {
			var payload any
			if action == "send" {
				payload = map[string]string{"input": input}
			}
			err = client.Request(ctx, "POST", api.AgentPath(action, initial.ID), payload, nil)
			if err != nil {
				closeStream()
				return err
			}
			started = true
		}
		for _, permission := range snapshot.Pending {
			if err := approve(permission); err != nil {
				closeStream()
				return err
			}
		}
		// At idle, the server's saved-history reset leaves only the old finish
		// and title. Any progress belongs to the new run; agent-start itself
		// may already have been cleared by a tool step before we connect.
		accept := action == "watch" || attempt > 0
		var earlyFinish *api.Event
		check := time.NewTicker(time.Second)
		var idle <-chan time.Time
		var timer *time.Timer
		if (attempt > 0 || action == "watch") && !snapshot.Running {
			timer = time.NewTimer(time.Second)
			idle = timer.C
		}
		consume := func() error {
			for {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-idle:
					return nil
				case <-check.C:
					if accept || earlyFinish == nil {
						continue
					}
					current, readErr := client.Session(ctx, initial.ID)
					if readErr != nil {
						return readErr
					}
					if !current.Running && (len(current.History) > len(initial.History) || action == "resume") {
						if hooks.Event != nil {
							hooks.Event(*earlyFinish)
						}
						if message := earlyFinish.Failure(); message != "" {
							return &runFailure{message}
						}
						return nil
					}
				case item := <-packets:
					if item.err != nil {
						return item.err
					}
					event := item.event
					if event.Type != "agent-finish" && event.Type != "title" {
						accept = true
					}
					// A fast run may finish before SSE connects and its start was
					// already cleared by saving history. Verify the new history
					// before accepting a finish without its start.
					if !accept && event.Type == "agent-finish" {
						earlyFinish = &event
					}
					if !accept {
						continue
					}
					// Compaction shares delta/error event types with answers. Keep the
					// raw events for NDJSON, but never save them as a partial answer.
					if event.IsCompact() {
						if hooks.Event != nil {
							hooks.Event(event)
						}
						continue
					}
					switch event.Type {
					case "llm-start":
						content, reasoning = "", ""
					case "text-delta":
						content += event.Text
					case "reasoning-delta":
						reasoning += event.Text
					case "llm-finish":
						if event.Text != "" {
							content = event.Text
						}
					}
					if hooks.Event != nil {
						hooks.Event(event)
					}
					if event.Type == "permission" {
						if err := approve(api.Permission{CallID: event.CallID, Tool: event.Tool, Input: event.Input}); err != nil {
							return err
						}
					}
					if event.Type == "agent-finish" {
						if message := event.Failure(); message != "" {
							return &runFailure{message}
						}
						return nil
					}
				}
			}
		}
		err = consume()
		check.Stop()
		if timer != nil {
			timer.Stop()
		}
		closeStream()
		var failure *runFailure
		var approvalError *permissionFailure
		if err == nil || errors.As(err, &failure) || errors.As(err, &approvalError) || errors.Is(err, ErrPending) || ctx.Err() != nil {
			return err
		}
		// Only stream errors reconnect. A permission handler error is actionable.
		if _, ok := err.(*api.HTTPError); ok {
			return err
		}
		// 只取消了这一路订阅。减回去，循环自己还会加一，所以不占用四次失败。
		if errors.Is(err, context.Canceled) && ctx.Err() == nil {
			attempt--
		}
	}
	return fmt.Errorf("实时连接中断，任务可能仍在运行；使用 chat --session %s 重新连接: %w", initial.ID, err)
}

type runFailure struct{ message string }

func (e *runFailure) Error() string { return e.message }

type permissionFailure struct{ error }

func (e *permissionFailure) Unwrap() error { return e.error }
