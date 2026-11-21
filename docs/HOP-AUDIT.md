# 接手说明

最后更新：2026-11-22。这是当前仓库的结构。

## 先读什么

1. [README.md](../README.md)：现在有什么、怎么启动、有哪些接口。
2. [AGENTS.md](../AGENTS.md)：提交、版本号、验证。
3. [NOTES.md](../NOTES.md)：定位、核心概念、数据形状、扩展写法。

## 现在长什么样

```text
backend/server.js              路由：stream / send / compact / stop / configure、extensions、op
backend/features/
  Agents.js                    打开、发送、停止、压缩、截断历史
  Stream.js                    SSE 订阅、尾巴合并、run / cut / core 分发
  Store.js                     AGENT_HOME（默认 ~/.agent）里的 config 与 meta / history
  Models.js                    供应商/模型 → agent-core 连接参数，无供应商特例
  Extension.js                 patch 链、ctx.tool / op / expose / use
  Loader.js                    扫描、拓扑、启停、打包前端入口
  Bundle.js                    Bun.build + Vue SFC，vue 留成外部引用
web/src/
  api.ts                       唯一请求出口；connect 走 SSE
  Agent.ts                     历史只跟 core 的 message，实时状态跟事件走
  Extension.ts                 组件表、patch、加载 /api/extensions
  App.vue                      对话流 + 输入区，没有顶栏
  components/                  History、Composer、Stats、ToolCall…
extensions/<name>/             内置与第三方同一写法（manifest + backend.js + 可选 frontend/）
```

依赖：`@kernel4632/agent-core` 通过 npm 的 `^1.2.1` 安装（`bun install` 即可），不要改用 `file:` 本地路径。

## 一次请求怎么走

```text
浏览器  --POST /api/agent/:id/send-->  Agents.send
                                     agent-core 循环写历史、发事件
浏览器  <--GET  /api/agent/:id/stream--  先 snapshot，再 core / run / cut / 扩展事件
```

扩展后端在进程启动时织入；扩展前端由 Loader 打包，页面按 `GET /api/extensions` 给出的地址 `import`。

## 数据

数据目录是 `AGENT_HOME`，默认 `~/.agent`。

- `config.json`：供应商、默认模型、MCP、权限、压缩阈值、扩展/技能关闭名单。
- `agents/<id>/meta.json`：标题、分组、模型、思考强度、学到的比例、更新时间。
- `agents/<id>/history.jsonl`：一行一条 core 消息，只有截断时整份重写。
- `agents/<id>/todos.json`：用过任务清单时才有。

没有其他目录会被读取。

## 验证

```sh
cd backend && bun test --max-concurrency 1
cd web && bun run check && bun run build
```

2026-11-21 的 mock 测试：28 个通过、1 个真实请求测试默认跳过；需要 Bun ≥ 1.4.4（测试夹具用了 `ReadableStream.from`，1.3 上重连那条会红）。
前端 `vue-tsc` 与 `vite build` 通过。数字只用来对照，验收以当次输出为准。

## 已知边界

- `snapshot` 一次发完整历史，没有分页；很长的会话打开会慢（实测 1.6 万条 ≈ 51MB，读取约 20 秒）。
- cwd 还没按会话保存；工具继承后端进程的工作目录。
- MCP 只支持 http / sse，stdio 条目接不了。
- 桌面端还没开始；git、项目规则、斜杠命令、子 agent、流程编排都不做。
- 服务端没有登录鉴权。部署时让前后端同源或走反向代理，并关闭 SSE 缓冲。
