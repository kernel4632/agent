# macOS 使用与验证

当前用 `backend/` + `web/`。桌面应用尚未实现，没有 `.app` 或 DMG。

## 安装和启动

安装 Bun（官方安装器），然后重新打开终端：

```sh
curl -fsSL https://bun.sh/install | bash
bun --version
```

在仓库里安装依赖并分别启动：

```sh
(cd backend && bun install)
(cd web && bun install)
```

```sh
cd backend && bun start     # 127.0.0.1:3000
```

```sh
cd web && bun dev           # 127.0.0.1:5180，把 /api 代理到后端
```

打开 http://127.0.0.1:5180 ，在设置里填写供应商和对话模型。后端端口可用 `PORT` 改变。隔离运行示例：

```sh
AGENT_HOME="$PWD/tmp/mac-data" PORT=3101 bun --cwd backend start
# 另改 web 的代理目标后再开 bun dev；日常数据目录是 ~/.agent
```

指定 `AGENT_HOME` 后，技能目录会使用该目录下的 `skills/`。全局技能也可以放在 `~/.agents/skills`。

演示模式不连后端：http://127.0.0.1:5180/?demo

## 系统行为

- 命令工具通过 shell 执行，请用 POSIX 语法。macOS 自带 BSD 工具，参数可能与 GNU/Linux 不同。
- 原生依赖必须在当前 Mac 上安装，不要复用其他机器或架构的 `node_modules`。

## 验证

用临时数据目录跑测试，不要写真实的 `~/.agent`：

```sh
(cd backend && bun test)
(cd web && bun run check && bun run build)
```

`bun test` 只用 mock，不打真实模型。一次真实请求需显式 `RUN_REAL=1 bun test tests/real.send.test.js`，并准备好本机密钥。
