/*
调色板：终端界面的颜色只在这里定义一次，界面和 Markdown 都从这里取。

取色来自 omp 的 titanium 主题（用户 omp 配置里选的就是这套）：冷灰框线 + 电光蓝强调 +
钛金标签 + 读数绿/警报红。角色名与 omp 一致，认得出是同一套设计语言。
正文不指定颜色，跟随终端默认前景——和 omp 的 text: "" 一样，浅色终端下正文仍然可读。

框线比 omp 的 #2a3038 提亮了一档：omp 的边框画在深色面板上，这里直接画在终端背景上，
再暗就看不见了。

调用示例：

	render.Accent.Render("标题")
	render.Paint(diff)
*/
package render

import "charm.land/lipgloss/v2"

const (
	ColorAccent  = "#00b4ff" // 电光蓝：焦点、强调、当前选中
	ColorGold    = "#d4c090" // 钛金：标签、内联代码
	ColorSuccess = "#00ff88" // 读数绿：完成、新增
	ColorError   = "#ff4757" // 警报红：失败、删除
	ColorWarning = "#ffb347" // 琥珀：等待、拒绝、提醒
	ColorMuted   = "#9ca3b0" // 次要信息、说明
	ColorDim     = "#6b7280" // 折叠提示、时间、快捷键
	ColorBorder  = "#39414d" // 框线、分隔线
)

var (
	Accent  = lipgloss.NewStyle().Foreground(lipgloss.Color(ColorAccent)).Bold(true)
	Gold    = lipgloss.NewStyle().Foreground(lipgloss.Color(ColorGold))
	Success = lipgloss.NewStyle().Foreground(lipgloss.Color(ColorSuccess))
	Error   = lipgloss.NewStyle().Foreground(lipgloss.Color(ColorError))
	Warning = lipgloss.NewStyle().Foreground(lipgloss.Color(ColorWarning))
	Muted   = lipgloss.NewStyle().Foreground(lipgloss.Color(ColorMuted))
	Dim     = lipgloss.NewStyle().Foreground(lipgloss.Color(ColorDim))
	Border  = lipgloss.NewStyle().Foreground(lipgloss.Color(ColorBorder))
)
