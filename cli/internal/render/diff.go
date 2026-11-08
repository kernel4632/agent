/*
差异呈现：把前后两段文本算成 unified diff 并着色，长内容只给摘要。

调用示例：
  if render.LooksLikeDiff(output) { print(render.Paint(output)) }
  text, added, removed := render.Unified(before, after)
*/
package render

import (
	"strings"
)

var (
	addStyle  = Success
	delStyle  = Error
	hunkStyle = Accent // @@ 行用强调蓝，和增删的绿红分开
	metaStyle = Dim    // diff --git、索引行只是定位用的
)

// LooksLikeDiff reports whether text is a unified diff rather than ordinary output.
func LooksLikeDiff(text string) bool {
	if strings.HasPrefix(text, "diff --git ") || strings.Contains(text, "\ndiff --git ") {
		return true
	}
	return strings.Contains(text, "\n@@") && (strings.Contains(text, "\n+") || strings.Contains(text, "\n-"))
}

// Unified builds a line diff. Large inputs are summarized instead of compared.
func Unified(before, after string) (text string, added, removed int) {
	before = strings.ReplaceAll(before, "\r\n", "\n")
	after = strings.ReplaceAll(after, "\r\n", "\n")
	a := strings.Split(before, "\n")
	b := strings.Split(after, "\n")
	if len(a) > 0 && a[len(a)-1] == "" {
		a = a[:len(a)-1]
	}
	if len(b) > 0 && b[len(b)-1] == "" {
		b = b[:len(b)-1]
	}
	if len(a)*len(b) > 160000 {
		return "（文件太大，省略逐行对照）", countNonEmpty(b), countNonEmpty(a)
	}
	script := lineDiff(a, b)
	var bld strings.Builder
	for _, op := range script {
		switch op.kind {
		case '+':
			added++
			bld.WriteString("+")
			bld.WriteString(op.text)
		case '-':
			removed++
			bld.WriteString("-")
			bld.WriteString(op.text)
		default:
			bld.WriteString(" ")
			bld.WriteString(op.text)
		}
		bld.WriteByte('\n')
	}
	return strings.TrimRight(bld.String(), "\n"), added, removed
}

type edit struct {
	kind byte
	text string
}

func lineDiff(a, b []string) []edit {
	n, m := len(a), len(b)
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
	}
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			if a[i] == b[j] {
				dp[i][j] = dp[i+1][j+1] + 1
			} else if dp[i+1][j] >= dp[i][j+1] {
				dp[i][j] = dp[i+1][j]
			} else {
				dp[i][j] = dp[i][j+1]
			}
		}
	}
	var out []edit
	i, j := 0, 0
	for i < n && j < m {
		if a[i] == b[j] {
			out = append(out, edit{' ', a[i]})
			i++
			j++
			continue
		}
		if dp[i+1][j] >= dp[i][j+1] {
			out = append(out, edit{'-', a[i]})
			i++
		} else {
			out = append(out, edit{'+', b[j]})
			j++
		}
	}
	for i < n {
		out = append(out, edit{'-', a[i]})
		i++
	}
	for j < m {
		out = append(out, edit{'+', b[j]})
		j++
	}
	return out
}

func countNonEmpty(lines []string) int {
	n := 0
	for _, line := range lines {
		if line != "" {
			n++
		}
	}
	return n
}

// Paint colors unified diff lines. Non-diff lines stay as they are.
func Paint(text string) string {
	if text == "" {
		return ""
	}
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		switch {
		case strings.HasPrefix(line, "@@"):
			lines[i] = hunkStyle.Render(line)
		case strings.HasPrefix(line, "diff ") || strings.HasPrefix(line, "index ") || strings.HasPrefix(line, "--- ") || strings.HasPrefix(line, "+++ "):
			lines[i] = metaStyle.Render(line)
		case strings.HasPrefix(line, "+"):
			lines[i] = addStyle.Render(line)
		case strings.HasPrefix(line, "-"):
			lines[i] = delStyle.Render(line)
		}
	}
	return strings.Join(lines, "\n")
}

// Clip keeps the first n lines and reports how many were dropped.
func Clip(text string, n int) string {
	if n <= 0 {
		return ""
	}
	lines := strings.Split(text, "\n")
	if len(lines) <= n {
		return text
	}
	return strings.Join(lines[:n], "\n") + "\n… 其余 " + itoa(len(lines)-n) + " 行已截断"
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [16]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
