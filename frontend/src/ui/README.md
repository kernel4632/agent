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

发现 KIMA 的问题时提到 `kernel4632/kima`，不要在项目里写覆盖式兼容层。
