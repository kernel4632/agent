# 给接手的人

本仓库是 agent-core 的可视化 + 扩展系统。循环和历史只由 agent-core 写。当前分支的后端是 `backend/`，界面是 `web/`，内置扩展在 `extensions/`。

## 目录

```text
backend/server.js          路由表（Bun.serve）
backend/features/          Agents、Stream、Store、Models、Extension、Loader、Bundle
web/src/                   api.ts、Agent.ts、Extension.ts、App.vue、components/
extensions/<name>/         manifest.json、backend.js、可选 frontend/index.js 和工具文件
```

导入只往下走：`server.js → Agents / Stream / Loader → Extension / Models → Store → agent-core`。同层不互相 import。方法写成 `Name.verb`。这张层级规矩由 `tools/architecture.js --check` 机器把关，图见 `docs/architecture.md`。

## 提交与版本

一小步一次提交，信息用 `feat:` / `fix:` / `chore:` 开头，用中文说清改了什么。不要把不相关的事混在一起。

每次有实际行为变化、准备提交前，改对应一半的版本号：

| 改了哪里 | 改哪个文件 |
| --- | --- |
| `backend/` | `backend/package.json` 的 `version` |
| `web/` | `web/package.json` 的 `version` |
| 两边都改了 | 两个都改 |

加能力改第二位（`0.2.0` → `0.3.0`），只修问题或文档改第三位（`0.2.0` → `0.2.1`）。

## 启动

```sh
cd backend && bun start     # 127.0.0.1:3000，默认数据目录 ~/.agent
cd web && bun dev           # 127.0.0.1:5180，代理 /api
```

演示模式：http://127.0.0.1:5180/?demo （不连后端，扩展不会加载）。开发和测试用 `AGENT_HOME` 指向临时目录，不要写用户真实的 `~/.agent`。没有用户明确要求时，不要占用 3000 / 5180，也不要主动杀已有进程。

依赖 npm 上的 `@kernel4632/agent-core` `^1.2.1`。要改 core 时先在 agent-core 仓库发新版，再在这里升依赖；不要提交 `file:` 本地路径。

## 验证

```sh
cd backend && bun test --max-concurrency 1    # 只用 mock；真实请求需显式 RUN_REAL=1
cd web && bun run check && bun run build
```

新加接口或改行为时，在同一次提交里补上测试。`bun test` 默认会跳过 `tests/real.send.test.js`。

## 代码规矩

- 文件大约 50～200 行，按业务拆，中文注释。
- 不开只放一两个文件的文件夹。
- 通用代码里不写某个供应商的特例。
- 前端显示要忠于真实状态：没有 `request-start` 就不要出现请求条，用户消息等 core 的 `message` 事件到来再出现。
- 发布前不写向后兼容。

## 路由

路由只在 `backend/server.js` 写一次：

- `GET /api/agent/:id/stream`
- `POST /api/agent/:id/send` / `compact` / `stop` / `configure`
- `GET /api/extensions`、`GET /api/extensions/inspect`、`GET /api/extensions/:name/frontend.js`
- `POST /api/op/:name`

正在跑的会话再 send / compact 返回 409。进程重启不自动续跑。

## 扩展

扩展扫描 `extensions/` 和 `~/.agents/extensions`，按 `requires` 拓扑、`after` 软边加载 `backend.js`。前端入口打包后由网页 `import`。业务代码用 `ctx.patch` / `ctx.tool` / `ctx.op` 和 `app.shell` / `app.settings` / `app.toolViews`。加号菜单只留给上传文件。内置扩展示例的分工见 `NOTES.md` 第七节。
