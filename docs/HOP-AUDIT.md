# 接手说明

最后更新：2026-11-20。这是当前仓库的结构，不是旧 `server/` / `frontend/` / `cli/` 的审查。那三处已经删除。

## 先读什么

1. [README.md](../README.md)：现在有什么、怎么启动、有哪些接口。
2. [AGENTS.md](../AGENTS.md)：提交、版本号、验证。
3. [NOTES.md](../NOTES.md)：定位、原版本体和扩展系统设计。

## 现在长什么样

```text
backend/server.js              路由：stream / send / compact / stop / configure、extensions、op
backend/features/
  Agents.js                    打开、发送、停止、压缩、截断历史
  Stream.js                    SSE 订阅、尾巴合并、run / cut / core 分发
  Store.js                     AGENT_HOME（默认 ~/.agent）里的 config 与会话落盘
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
extensions/<name>/             内置与第三方同一写法（见 NOTES 第五节）
```

依赖：`@kernel4632/agent-core` 通过 `file:../../agent-core` 引用本地 1.2.1，尚未发到 npm。

## 一次请求怎么走

```text
浏览器  --POST /api/agent/:id/send-->  Agents.send
                                     agent-core 循环写历史、发事件
浏览器  <--GET  /api/agent/:id/stream--  先 snapshot，再 core / run / cut / 扩展事件
```

扩展后端在进程启动时织入；扩展前端由 Loader 打包，页面按 `GET /api/extensions` 给出的地址 `import`。

## 验证

```sh
cd backend && bun test --max-concurrency 1
cd web && bun run check && bun run build
```

2026-11-20 的 mock 测试是后端 27 个通过（另有一条真实请求默认跳过），前端 `vue-tsc` 通过。数字只用来对照，验收以当次输出为准。

## 已知边界

- 桌面端还没开始。
- 工具工作目录继承服务进程的 cwd；按会话分开的工作区还没有。
- 不提供 git、项目规则、斜杠命令，这些留给 fork 后的产品。
- 服务端没有登录鉴权。部署时让前后端同源或走反向代理，并关闭 SSE 缓冲。
- agent-core 1.2.1 的 `message` 事件还只在本地，发布前不要假定 npm 上已经有。
