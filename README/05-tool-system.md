# 工具系统

## 统一注册表

模型只看到 `store.tools.items` 中的统一工具注册表。工具来源包括：

- `server/tools/built-in/*.js`：随 Server 分发的内置工具。
- 用户数据目录 `tools/custom/*.js`：用户自定义工具。
- MCP Server：运行时映射为同一 AI SDK 工具结构。
- LSP：运行时注册的代码导航与诊断工具。
- Skills：先披露目录，再通过工具读取完整说明。

所有 Agent 和所有 Run 共用该注册表。Agent 定义不复制工具列表。

## 本地工具协议

一个 `.js` 文件可以包含多个命名导出。具有 `description` 和 `execute` 的导出会注册为工具：

```javascript
export const read_file = {
  description: '读取指定文件。',
  parameters: {
    path: { type: 'string', description: '文件路径', required: true }
  },
  async execute({ path }, context) {
    return { result: '...' }
  }
}
```

`parameters` 支持 `string`、`number`、`boolean`、`array`、`object`、`enum`、`required` 和 `default`。Chat Command 将其递归转换为 Zod schema；MCP 工具保留原生 JSON Schema。

工具结果至少应包含 `result`：

```javascript
return { result: '执行结果' }
return { result: '任务完成', stop: true }
```

`stop: true` 请求当前 Agent 循环结束。抛出的异常会转换为 `工具执行失败: ...`，作为可恢复 tool result 返回模型。

## 执行上下文

本地工具的第二个参数是受控上下文：

```javascript
async execute(input, {
  sessionID,
  updateTasks,
  spawnAgent
}) {}
```

- `sessionID` 只用于识别归属。
- `updateTasks(tasks)` 通过 Session Command 校验、持久化并发送 SSE。
- `spawnAgent(prompt, agentID)` 创建 Child Run。

自定义工具不应直接导入或修改 `store`。新的领域动作应先进入 Command，再通过上下文暴露。

## 内置 Agent 工具

### `task_done`

```json
{ "summary": "任务完成情况" }
```

返回 `stop: true`，结束当前循环。

### `task_list_update`

提交完整任务数组，每项包含：

```json
{
  "content": "运行测试",
  "status": "in_progress",
  "priority": "high"
}
```

`status` 为 `pending`、`in_progress`、`completed`、`cancelled`；更新成功后发出 `task-list-updated`。

### `spawn_agent`

```json
{
  "prompt": "独立检查认证模块的并发问题",
  "agentId": "reviewer"
}
```

- `prompt` 必填，必须是独立子任务。
- `agentId` 可选，省略时使用默认 Agent。
- 创建独立 Child Run 和模型上下文。
- 共享权限、工具、MCP、LSP、Skills 和工作区。
- 结果返回 `{ result, childRunID }` 给父 Agent。
- 最大深度 4，每个 Child Run 最多 8 个模型轮次。

## 加载与热重载

Server 启动时扫描内置和自定义目录。`chokidar` 监听直接子目录中的 `.js` 文件：

- 新增：动态导入并注册全部有效命名导出。
- 修改：移除该文件旧导出，再使用带时间戳 URL 重新导入。
- 删除：移除该文件注册的全部工具。

单文件加载失败不会阻断其他文件；`POST /tool/reload` 返回 `loaded`、`files` 和 `errors`。Runtime 关闭或启动失败时会关闭 watcher。

## 工具目录 API

`GET /tool/list` 只返回公开描述，不返回执行函数：

```json
{
  "name": "read_file",
  "label": "read_file",
  "description": "读取指定文件。",
  "parameters": {},
  "source": "built-in",
  "kind": "built-in",
  "server": "",
  "originalName": ""
}
```

`kind`、`server` 和 `originalName` 用于识别 MCP/LSP 等动态来源。

## 安全边界

工具代码运行在 Agent Server 进程中，不是沙箱。每次执行前必须经过当前全局权限配置；未配置工具默认 `ask`。热重载只解决加载生命周期，不提供隔离或可信度保证。

自定义工具可导入 Bun 能解析的依赖，但依赖安装和供应链风险由运行环境负责。
