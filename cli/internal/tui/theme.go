/*
界面样式：把调色板组合成界面用得上的几种，颜色本身不在这里定义（见 render/theme.go）。
焦点蓝、标签金、两层灰是整套界面的层级：蓝指向“现在该看这里”，金标出名字，灰退到背景里。

调用示例：

	accent.Render(标题)
	userBar.Render("┃")
*/
package tui

import (
	"charm.land/lipgloss/v2"
	"github.com/kernel4632/agent/cli/internal/render"
)

var (
	accent    = render.Accent  // 标题、选中项、正在执行
	gold      = render.Gold    // 标签、模型名
	muted     = render.Muted   // 次要信息
	dim       = render.Dim     // 时间、快捷键、折叠提示
	hairline  = render.Border  // 分隔线、未聚焦的输入框边
	okText    = render.Success // 完成
	errText   = render.Error   // 失败
	warnText  = render.Warning // 等待、拒绝
	userBar   = lipgloss.NewStyle().Foreground(lipgloss.Color(render.ColorGold))
	userLabel = lipgloss.NewStyle().Foreground(lipgloss.Color(render.ColorGold)).Bold(true)
)
