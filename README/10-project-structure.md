# 项目目录结构

## Agent Server（Bun + Elysia）

遵循 HOP 规范的架构主线：触发入口 → 指令执行 → 数据修改 → 效果反馈。

```
agent/
├── server.js                  # 入口：启动 Elysia，注册路由
├── routes/                    # 路由层：接收 HTTP 请求 → 调用指令
│   ├── chat.js                # POST /chat/send, /chat/stop, /chat/approve, /chat/reject
│   ├── session.js             # 会话管理路由
│   ├── tool.js                # 工具管理路由
│   └── config.js              # 配置管理路由
├── commands/                  # 指令层：业务逻辑集中在这里
│   ├── chat.js                # 对话指令（startLoop, stopLoop, approve, reject）
│   ├── session.js             # 会话指令（create, list, get, remove, rollback）
│   ├── tool.js                # 工具指令（load, reload, list）
│   ├── config.js              # 配置指令（load, save, update）
│   └── checkpoint.js          # 存档指令（save, load, rollback）
├── store/                     # 数据层：运行时状态
│   ├── sessions.js            # 会话数据（Map 结构，sessionId → session）
│   ├── tools.js               # 工具注册表（Map 结构，toolName → tool）
│   ├── config.js              # 配置数据（内存缓存 + 文件同步）
│   └── checkpoints.js         # 存档点索引（sessionId → checkpoints[]）
├── tools/                     # 工具文件目录
│   ├── built-in/              # 内置工具
│   │   ├── read-file.js
│   │   ├── write-file.js
│   │   ├── run-command.js
│   │   ├── list-files.js
│   │   ├── search-files.js
│   │   ├── web-fetch.js
│   │   └── task-done.js
│   └── custom/                # 用户/LLM 自定义工具
├── utils/                     # 纯工具函数（无业务身份）
│   ├── retry.js               # 指数退避重试
│   ├── token.js               # Token 计数
│   ├── id.js                  # ID 生成
│   └── wildcard.js            # 通配符匹配
├── package.json
└── bun.lockb
```

## 前端（Vue 3 + JavaScript）

```
frontend/
├── src/
│   ├── main.js                # 入口
│   ├── App.vue                # 根组件
│   ├── views/                 # 页面组件
│   │   ├── Chat.vue           # 对话主界面
│   │   ├── Sessions.vue       # 会话列表
│   │   ├── Settings.vue       # 配置页面
│   │   └── Tools.vue          # 工具管理
│   ├── components/            # 子组件
│   │   ├── MessageList.vue    # 消息列表
│   │   ├── MessageItem.vue    # 单条消息
│   │   ├── ToolCall.vue       # 工具调用展示
│   │   ├── ReasoningBlock.vue # thinking 折叠块
│   │   ├── InputBox.vue       # 输入框
│   │   ├── ProviderConfig.vue # 供应商配置
│   │   └── PermissionEditor.vue # 权限编辑器
│   ├── api/                   # API 调用封装
│   │   ├── chat.js            # 对话相关 API
│   │   ├── session.js         # 会话相关 API
│   │   ├── tool.js            # 工具相关 API
│   │   └── config.js          # 配置相关 API
│   ├── stores/                # 状态管理（Pinia）
│   │   ├── chat.js            # 对话状态
│   │   ├── session.js         # 会话列表
│   │   ├── config.js          # 配置状态
│   │   └── ui.js              # UI 状态
│   └── utils/
│       ├── sse.js             # SSE 客户端封装
│       └── markdown.js        # Markdown 渲染
├── package.json
└── vite.config.js
```

## Go 层（桌面壳 + CLI TUI）

```
desktop/
├── main.go                    # 主程序入口
├── wails/                     # Wails 桌面相关
│   ├── app.go                 # Wails 应用初始化
│   └── bindings.go            # Go 方法暴露给前端
├── tui/                       # CLI TUI 实现
│   ├── main.go                # TUI 入口
│   ├── ui.go                  # BubbleTea UI 逻辑
│   └── sse.go                 # TUI 的 SSE 客户端
├── process/                   # 进程管理
│   ├── server.go              # 启动/管理 Agent Server 子进程
│   └── embed.go               # 嵌入式二进制资源
├── go.mod
└── go.sum
```

## 用户数据目录

```
~/.agent/                      # Windows: %USERPROFILE%\.agent
├── config.json                # 全局配置
├── tools/                     # 工具目录
│   ├── built-in/              # 内置工具（从分发包复制）
│   └── custom/                # 用户自定义工具
├── sessions/                  # 会话持久化存储
│   ├── ses_a1b2c3.json
│   ├── ses_d4e5f6.json
│   └── ...
├── package.json               # 工具依赖管理
└── node_modules/              # 工具使用的第三方库
```

## HOP 规范对应

| HOP 层 | 本项目实现 |
|--------|------------|
| 触发入口 | routes/ — 接收 HTTP 请求 |
| 指令执行 | commands/ — 业务逻辑 |
| 数据存储 | store/ — 运行时状态 + ~/.agent/ 持久化 |
| 副作用响应 | SSE 推送、文件监听（工具热重载） |
| 通用工具 | utils/ — 无业务身份的纯函数 |
