# Agent

AI Agent 桌面/CLI 软件。对话驱动，工具自主调用，支持长时间运行任务。

## 特性

- 对话驱动的 ReAct 循环，无步数上限
- 工具粒度存档点，细颗粒度回滚
- 指数退避无限重试
- 可视化供应商配置（多供应商、多模型切换即时生效）
- 自定义系统提示词
- reasoning 思考折叠
- 自动扫描加载工具，用户可用 JS 编写自定义工具
- 权限系统（allow / ask / deny + 通配符匹配）

## 技术栈

| 层           | 技术                                 |
| ------------ | ------------------------------------ |
| 桌面         | Go + Wails                           |
| CLI          | Go + BubbleTea                       |
| 前端         | Vue 3 + JavaScript                   |
| Agent Server | Bun + Elysia + Vercel AI SDK         |
| 分发         | bun compile 嵌入 Go 二进制，开箱即用 |

## 运行模式

三种模式共享同一个 Agent Server 进程：

- **桌面模式** — Wails 窗口
- **CLI 模式** — 终端 TUI
- **开发模式** — 浏览器 + 独立 Agent Server