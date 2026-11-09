/*
任务清单页：模型更新清单后，这里显示进度和每一条的状态。
完成的条目压暗，进行中的用强调色。
*/
package tui

import (
	"strings"
)

func (m *model) openTodos() {
	m.overlay = overlayState{kind: "todos"}
	m.focus = focusOverlay
	m.input.Blur()
	m.renderConversation(true)
}

func (m *model) todosText() string {
	var b strings.Builder
	b.WriteString(accent.Render("任务清单") + "\n\n")
	if len(m.todos) == 0 {
		b.WriteString(dim.Render("还没有任务。模型更新清单后会显示在这里。"))
		return strings.TrimRight(b.String(), "\n")
	}
	done := 0
	for _, item := range m.todos {
		if item.Status == "completed" {
			done++
		}
	}
	b.WriteString(gold.Render("进度 "+itoa(done)+"/"+itoa(len(m.todos))) + "\n\n")
	for _, item := range m.todos {
		mark, style := "·", dim
		switch item.Status {
		case "completed":
			mark, style = "✓", okText
		case "in_progress":
			mark, style = "▸", accent
		}
		text := item.Text
		if item.Status == "completed" {
			text = dim.Render(text) // 做完的退到背景里，没做的才是当前要看的
		}
		b.WriteString(style.Render(mark) + " " + text + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}
