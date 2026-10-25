# UI 适配边界

页面和业务组件只从 `./index.js` 导入 `AppIcon`、`Button`、`Dialog`、`Field`、`IconButton`、`Switch`、`avatarColor`、`initial`。KIMA 已经提供、且没有额外布局需求的控件（例如 `KimaSelect`）直接在页面里从 `@kernel4632/kima` 导入，不再经过适配层。

这些名字是 KIMA 适配层，不是独立手写控件：

- `AppIcon` → `KimaIcon`
- `Button` → `KimaButton`（`plain` 行按钮保留自定义外壳）
- `Dialog` → `KimaDialog`
- `Field` → `KimaTextField` / `KimaTextarea`
- `IconButton` → `KimaIconButton`
- `Switch` → `KimaSwitch`
- `Sheet` → `KimaDrawer`
- 左侧会话抽屉 `app/AppDrawer.vue` → `KimaDrawer`（left）
- 右侧文件面板 `session/SessionFilePanel.vue` → `KimaDrawer`（right）
- 会话历史列表 → `KimaList`；行右侧菜单 → `MenuButton` → `KimaMenu`
- 提示条 → `KimaNotification`；连接错误 → `KimaAlert`
- 附件、建议和会话选项 → `KimaChip`；回退确认里的勾选 → `KimaCheckbox`
- 下拉选择直接使用 `KimaSelect`。KIMA 0.7.1 的 scopeId 发布错误由 `frontend/patches/` 修正，原因见 [kima#3](https://github.com/kernel4632/kima/issues/3)。

颜色、字体、阴影统一来自 KIMA token，映射写在 `styles/tokens.scss`。页面里可以继续写聊天、时间线、工具行这类 KIMA 没有的领域组件，但视觉要使用 `--kima-*`，不要另起一套配色。

## 尺寸和样式归属

- 控件尺寸由适配层统一：`Field` 64（`size="small"` 48），`Button` 48/56，`IconButton` 48/40。KIMA 控件按自己的尺寸走，页面只控制布局宽度。
- 页面优先不写 `:deep()` 去改 KIMA 内部元素，也不在页面里给 KIMA 控件设高度。当前例外集中在 `ui/` 适配层的尺寸（`Field`、`Sheet`、`MenuButton`）、会话抽屉和 `KimaList` 的行容器、以及 `SessionMorePanel` 的紧凑字号；每处都在代码旁写了原因，等 KIMA 提供对应能力后删除。
- 需要新的尺寸档位时，在适配层增加变体，再让页面使用；不要每个页面各写一套。
- 设置页统一用 20–24px 圆角卡片、24px 内边距和 16–24px 的分组间距；不做紧凑表格式布局。

发现 KIMA 的问题时提到 `kernel4632/kima`，不要在项目里写覆盖式兼容层。
