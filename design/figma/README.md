# Figma 设计数据（agent 文件）

从 Figma 文件 `agent`（fileKey `XwwINqg57AQGyocLYDNCVN`，页面 `Page 1`）通过 figma-console-mcp 抽取，已按“只保留前端能用到的数据”清理。全部为结构化数据，不含截图。

清理脚本：`scripts/clean.mjs`（幂等，可重复运行）。

## 文件

| 文件 | 内容 |
| --- | --- |
| `tokens/design-tokens.json` | 聚合样式：颜色、字体、效果、圆角、间距、内边距，含使用次数 |
| `raw/hierarchy.json` | 图层层级：结构、坐标尺寸、Auto Layout、填充、圆角、文字 |
| `raw/components.json` | 组件清单：名称、类型、尺寸、分类、变体 |
| `scripts/clean.mjs` | 清理脚本 |

## 已保留

- 顶层画板：`AI Agent Chat`（聊天页）、`Sidebar / Complete`（侧栏）、`设置页面`（中文版设置页）
- 组件：`用户头像`、`助手头像`、`Outgoing message`、`Agent message`、`Input composer`、`Auto Clear Toggle`（关/开两变体）
- 全部样式令牌：颜色、字体、效果、圆角、间距、内边距

## 已清理

- 标识类字段：节点 id、组件 key、实例 componentId（前端用不到）
- 顶层画板：`Settings Modal`（改为以中文版 `设置页面` 为准）、`图标` 陈列板、`组件` 陈列板
- 图标类组件（改用 Hugeicons 库）

## 落地前需要注意

- **尺寸非整数**：多处为缩放产生的非整值（如 `12.619`、`9.614`、`19.457`）。前端应统一归整。
- **字体不统一**：主体为 `HarmonyOS Sans SC`，聊天头部两处为 `Alibaba Health Font 2.0 CN 85 B`，需统一。
- **无样式/变量**：文件没有 Figma Styles 与 Variables，令牌按本目录 JSON 自建。
- **设置页开关用帧而非组件**：`设置页面` 内开关是普通 Frame（42×24，开启色 `#a978ff`），而 `Auto Clear Toggle` 组件为 52×30、开启色 `#a8c5ff`。落地前需定一套。
- **命名疑似笔误**：`设置页面` 中 `Server Heading` 的文字为“通用”，按位置应为“服务器”一类分组标题。
