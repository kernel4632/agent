package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// ReadEvents handles UTF-8, CRLF, comments and multi-line data across arbitrary
// network chunks. A callback error stops consumption (including a finished run).
func ReadEvents(reader io.Reader, receive func(Event) error) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 16*1024*1024)
	var lines []string
	dispatch := func() error {
		if len(lines) == 0 {
			return nil
		}
		data := strings.Join(lines, "\n")
		lines = nil
		if strings.TrimSpace(data) == "" {
			return nil
		}
		var event Event
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return fmt.Errorf("SSE 数据无法解析: %w", err)
		}
		if event.Type == "" {
			return nil
		}
		return receive(event)
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if err := dispatch(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, _ := strings.Cut(line, ":")
		if field == "data" {
			lines = append(lines, strings.TrimPrefix(value, " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	// An incomplete final frame is not a completed event.
	return io.ErrUnexpectedEOF
}
