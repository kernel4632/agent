# UI 适配边界

页面和业务组件只从 `./index.js` 导入 `AppIcon`、`Button`、`Dialog`、`Field`、`IconButton`、`Select`、`Switch`、`avatarColor`、`initial`。

这些名字现在是 KIMA 适配层，不是独立手写控件：

- `AppIcon` → `KimaIcon`
- `Button` → `KimaButton`（`plain` 行按钮保留自定义外壳）
- `Dialog` → `KimaDialog`
- `Field` → `KimaTextField` / `KimaTextarea`
- `IconButton` → `KimaIconButton`
- `Switch` → `KimaSwitch`
- `Sheet` → `KimaDrawer`
- `Select` 仍是自定义控件：KIMA 0.7.1 的 `KimaSelect` 有可见原生 select 的 bug（kima#3），修好后可以替换。

颜色、字体、阴影统一来自 KIMA token，映射写在 `styles/tokens.scss`。页面里可以继续写聊天、时间线、工具行这类 KIMA 没有的领域组件，但视觉要使用 `--kima-*`，不要另起一套配色。

## 尺寸和样式归属

- 控件尺寸由适配层统一：`Field` 64（`size="small"` 48），`Select` 64（small 40），`Button` 48/56，`IconButton` 48/40。
- 页面只传 `size` 和布局宽度，不写 `:deep()` 去改 KIMA 内部元素，也不在页面里给 KIMA 控件设高度。
- 需要新的尺寸档位时，在适配层增加变体，再让页面使用；不要每个页面各写一套。
- 设置页统一用 20–24px 圆角卡片、24px 内边距和 16–24px 的分组间距；不做紧凑表格式布局。

发现 KIMA 的问题时提到 `kernel4632/kima`，不要在项目里写覆盖式兼容层。
