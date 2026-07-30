# Agent 项目概述

## 定位

一款面向普通用户的 AI Agent 桌面/CLI 软件。类似 OpenCode 的体验：用户通过对话驱动 Agent 自主调用工具完成任务，支持长时间运行、自动重试、工具粒度存档回滚。

## 核心特性

- 对话驱动的 ReAct 循环（推理 → 行动 → 观察 → 再推理）
- 工具粒度存档点，支持细粒度回滚
- 指数退避无限重试，永不放弃
- 可视化供应商配置（API Key、模型选择、参数调整）
- 可自定义系统提示词
- reasoning 思考过程折叠展示
- 用户可编写自定义工具，自动扫描加载
- LLM 可自行编写工具供后续使用
- 权限系统（allow / ask / deny + 通配符匹配）

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 桌面壳 | Go + Wails | 跨平台桌面应用，单二进制分发 |
| CLI TUI | Go + BubbleTea | 终端富文本界面 |
| 前端 UI | Vue 3 + JavaScript | Wails WebView 内运行，不使用 TypeScript |
| Agent Server | Bun + Elysia | Agent 核心，SSE 流式通信 |
| Agent 循环 | Vercel AI SDK (`ai` 包) | ReAct 循环、工具调用、流式输出 |
| 供应商适配 | `@ai-sdk/openai`、`@ai-sdk/anthropic` 等 | 统一多供应商接口 |
| 运行时 | Bun | 高性能 JS 运行时，支持编译为单二进制 |
| 分发 | `bun build --compile` 嵌入 Go 主程序 | 开箱即用，零依赖 |

## 运行模式

1. **桌面模式** — Go Wails 启动窗口 + 内嵌 Agent Server
2. **CLI 模式** — Go BubbleTea TUI + 内嵌 Agent Server
3. **开发模式** — 独立运行 Agent Server + 浏览器访问 Vue 前端

三种模式共享同一个 Agent Server 进程。

## 设计参考

- **OpenCode** — 整体架构思路（Go 壳 + JS Agent Server + 双端共享）
- **Roo Code** — Agent 循环设计、工具粒度存档点、权限模型
- **Vercel AI SDK** — 底层 LLM 调用和工具执行框架
- **Elysia** — 高性能 HTTP Server + SSE 原生支持
