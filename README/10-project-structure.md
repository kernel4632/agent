# 项目目录结构

## Agent Server（Bun + Elysia）

遵循 HOP 规范的架构主线：触发入口 → 指令执行 → 数据修改 → 效果反馈。

路由注册直接在 `server/server.js` 入口完成（Elysia 声明式路由足够简洁，不需要拆成独立 route 文件）。

```
agent/
├── server/                # Agent Server 独立 Bun 子项目
│   ├── server.js          # 入口：启动 Elysia，注册全部路由 → 调用指令
│   ├── commands/          # 指令层：所有业务逻辑集中在这里
│   │   ├── chat.js        # 对话指令（startLoop, stopLoop, approve, reject）
│   │   ├── session.js     # 会话指令（create, list, get, remove, rollback, undoRollback）
│   │   ├── tool.js        # 工具指令（load, reload, list）
│   │   └── config.js      # 配置指令（load, save, update, getActiveModel）
│   ├── store/             # 数据层：运行时状态（概念上独立于指令层，必须分离）
│   │   ├── sessions.js    # 会话数据（消息历史 + 存档点，Map 结构）
│   │   ├── tools.js       # 工具注册表（Map 结构，toolName → tool）
│   │   └── config.js      # 配置数据（内存缓存 + 文件同步）
│   ├── tools/             # 工具文件目录（每个文件 = 一组同类工具）
│   │   ├── built-in/      # 内置工具集
│   │   │   ├── file.js    # 文件操作：read_file, write_file, list_files, search_files
│   │   │   ├── shell.js   # 命令执行：run_command
│   │   │   ├── web.js     # 网络操作：web_fetch
│   │   │   └── agent.js   # Agent 控制：task_done
│   │   └── custom/        # 用户/LLM 自定义工具集
│   ├── utils/             # 纯工具函数（无业务身份，可移植到其他项目）
│   │   ├── retry.js       # 指数退避重试
│   │   └── compress.js    # 上下文压缩（消息列表 → 压缩后消息列表，纯转换）
│   ├── package.json
│   └── bun.lock
├── frontend/              # Vue 前端子项目
└── desktop/               # Go 桌面与 CLI 子项目
```

## 前端（Vue 3 + JavaScript）

```
frontend/
├── src/
│   ├── main.js                # 入口
│   ├── App.vue                # 根组件
│   ├── api.js                 # API 调用封装（所有接口集中一个文件）
│   ├── views/                 # 页面组件
│   │   ├── Chat.vue           # 对话主界面
│   │   ├── Sessions.vue       # 会话列表
│   │   ├── Settings.vue       # 配置页面
│   │   └── Tools.vue          # 工具管理
│   ├── components/            # 子组件
│   │   ├── MessageList.vue    # 消息列表
│   │   ├── MessageItem.vue    # 单条消息
│   │   ├── ToolCall.vue       # 工具调用展示（含存档点回退按钮）
│   │   ├── ReasoningBlock.vue # thinking 折叠块
│   │   ├── InputBox.vue       # 输入框
│   │   ├── ProviderConfig.vue # 供应商配置
│   │   └── PermissionEditor.vue # 权限编辑器
│   ├── store.js               # 全局响应式工作台状态
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
├── tools/                     # 工具目录（每个文件 = 一组同类工具）
│   ├── built-in/              # 内置工具集（从分发包复制）
│   │   ├── file.js            # read_file, write_file, list_files, search_files
│   │   ├── shell.js           # run_command
│   │   ├── web.js             # web_fetch
│   │   └── agent.js           # task_done
│   └── custom/                # 用户自定义工具集
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
| 触发入口 | `server/server.js` 中的路由注册 → 调用指令 |
| 指令执行 | `server/commands/` — 业务逻辑 |
| 数据存储 | `server/store/` — 运行时状态 + ~/.agent/ 持久化 |
| 副作用响应 | SSE 推送、文件监听（工具热重载） |
| 通用工具 | `server/utils/` — 无业务身份的纯函数 |

## 追踪验证

以"用户发送消息"为例：

1. **入口** `server/server.js` → `POST /chat/send` → 调用 `Chat.startLoop()`
2. **指令** `server/commands/chat.js` → `startLoop()` 读取 session、tools、调用 `Config.getActiveModel()` → 调用 `compress()` 准备消息 → 调用 LLM → 执行工具 → 修改 session.messages
3. **数据** `server/store/sessions.js` → messages 数组被追加 → 持久化到 ~/.agent/sessions/xxx.json
4. **反馈** SSE 事件流推送到前端 → UI 自动更新

跳转文件数：`server/server.js` → `server/commands/chat.js` → `server/store/sessions.js` = 3 个文件（`server/utils/compress.js` 和 `server/utils/retry.js` 作为无状态工具函数被调用，不增加追踪复杂度）。
