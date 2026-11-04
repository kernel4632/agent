# run_flow：后续正式版计划

> 状态：暂缓，0.x 快速迭代期不实现。  
> 记录日期：2026-11-04。  
> 关联：`NOTES.md` 的「工具」与「子智能体」章节。

## 为什么现在不做

`new_task` 已经能覆盖 0.x 里的单次委托：独立历史、并行 tool call、权限回到主会话、可取消。  
`run_flow` 会同时改动工具协议、SSE、持久化、前端工具视图和模型提示词，属于正式版才值得引入的结构性能力，不适合在 0.x 里边跑边改。

对 Toolang 的调研结论也记录在这里：

- 它的 `agic` / `flow` / `caps` / `run` / `step` 设计值得借鉴；
- 但 Toolang 是独立的 Python 运行时，Windows 尚未支持，也没有把权限、工具、SSE、统计接进本项目的低成本方式；
- 因此不引入 Toolang 作为依赖，不复制它的语言和 CLI，只吸收「显式流程 + 可观察运行」这两个设计点。

## 目标

做一个内置工具 `run_flow`，让模型把复杂任务写成显式的 DAG，由后端按依赖执行多个子 agent：

- 顺序、并行、按依赖汇合；
- 每一步有自己的 prompt、状态、输出和错误；
- 主 agent 只拿回最终结论和步骤摘要，不把全部中间输出塞回上下文；
- 完整运行记录可被前端读取，做成只读蓝图；
- 复用现有工具、模型、权限审批、SSE 和取消信号。

## 明确不做

第一版不做以下内容，避免把工具做成第二个平台：

- 不引入 Toolang、Python 或新的 agent runtime；
- 不做自然语言 DSL 和 parser，先用 JSON DAG；
- 不做 chat/chore/talk 三类 driver；
- 不做 caps 市场、远程共享、Hub；
- 不做沙箱、Docker 编排；
- 不做 durable resume、fork、rewind、确定性重放；
- 不做拖拽式蓝图编辑器；
- 不做无限层级的 flow 嵌套；
- 不把每一步的完整输出返回给主 agent。

## 后端结构

不独立成库，也不塞进单个文件。按内部模块拆分，保持以后可抽取：

```text
server/tools/run_flow.js      薄工具：schema、参数校验、调用 runner、返回摘要
server/flows/spec.js          数据结构、ID/依赖/环校验、步数上限
server/flows/runner.js        就绪队列、并发、取消、步骤执行、失败策略
server/flows/store.js         run/step 记录、SSE 事件、读取
```

`run_flow` 仍然放在 `server/tools/`，由现有工具扫描自动发现。  
`server/flows/` 不 import `features/` 或 `commands/`；子 agent 执行器、工具表、审批函数由工具层注入，方便以后抽成独立包。

### 工具输入

第一版只接受 JSON，不接受代码或自然语言 DSL：

```json
{
  "goal": "调查并修复登录问题",
  "steps": [
    {
      "id": "research",
      "title": "定位失败原因",
      "prompt": "定位登录失败的相关代码和原因。",
      "dependsOn": []
    },
    {
      "id": "fix",
      "title": "修改实现",
      "prompt": "根据以下调查结果修改代码：\n{{steps.research}}",
      "dependsOn": ["research"]
    },
    {
      "id": "review",
      "title": "审查修改",
      "prompt": "审查这次修改：\n{{steps.fix}}",
      "dependsOn": ["fix"]
    }
  ],
  "maxParallel": 4,
  "onError": "fail",
  "final": "review"
}
```

约束：

- `id` 唯一，只允许字母、数字、下划线和短横线；
- 依赖必须存在且无环；
- 默认最多 20 步，硬上限可配置；
- `maxParallel` 默认 1，硬上限 4；
- `onError` 先支持 `fail` / `continue`；
- `final` 不填时取最后一个完成节点；
- 模板只支持 `{{steps.<id>}}` 这种安全替换，不执行表达式。

### 执行语义

- 按依赖计算就绪节点，持续调度，不做简单的整批 wave；
- 每个步骤创建一个独立子 agent，使用当前会话的模型、工具和审批；
- 失败的节点默认让整个 flow 失败；`continue` 模式下，依赖失败节点的步骤标记为 `skipped`；
- 主任务的 `abortSignal` 传到所有步骤，停止后不留下后台子任务；
- 步骤输出在步骤之间传递前做截断，避免上下文爆炸；
- 第一版 flow 步骤不暴露 `new_task` / `run_flow`，防止无限嵌套；
- 步骤的工具调用仍然走现有 `onPermission`，不能绕过审批。

### 工具返回

返回给主 agent 的内容必须短：

```json
{
  "flowId": "flow_xxx",
  "status": "completed",
  "final": "最终结论",
  "steps": [
    { "id": "research", "status": "completed", "summary": "..." },
    { "id": "fix", "status": "completed", "summary": "..." },
    { "id": "review", "status": "completed", "summary": "..." }
  ]
}
```

完整 prompt、输出、错误、耗时、Token 用量写入 run 记录，不进入主上下文。

### 运行记录

建议放在会话目录下，随会话删除一起清理：

```text
.agent/sessions/<sessionId>/flows/<flowId>.json
```

数据结构：

```text
FlowRun {
  id, sessionId, goal, status,
  createdAt, startedAt, finishedAt,
  steps: Step[],
  edges: { from, to }[]
}

Step {
  id, title, prompt, dependsOn,
  status: pending | running | completed | failed | skipped,
  startedAt, finishedAt,
  summary, output?, error?,
  usage?: { input, output, total },
  model?: { provider, model }
}
```

需要提供只读接口，例如 `GET /flow/read/:sessionId/:flowId`，并在会话读取时不把整个 run 塞进历史。

### SSE

复用现有 SSE，增加事件：

- `flow-start`
- `flow-step`（步骤状态变化）
- `flow-finish`

事件只带流程摘要和状态；完整内容通过 run 记录读取，避免把 SSE 撑大。

## 前端蓝图

第一版是只读运行图，不是编辑器。

建议新增独立分组，避免 `activity` 目录继续膨胀：

```text
frontend/src/components/flow/FlowRun.vue     工具卡片内的流程摘要和入口
frontend/src/components/flow/FlowGraph.vue   节点、连线、状态、详情
frontend/src/styles/components/flow/...
```

展示方式：

- 工具卡片默认只显示：目标、步骤数、状态、最终结果摘要；
- “查看流程”打开只读蓝图；
- 按 `dependsOn` 计算层级，自动布局；
- 节点显示标题、状态、耗时、模型、Token；
- 边表示依赖；
- 点击节点查看完整输出/错误；
- 运行中按 SSE 更新节点状态；
- 先不引入完整图编辑器，节点数量有限时用 SVG/绝对定位即可。

如果后面要做可编辑蓝图，再单独评估图库、拖拽、保存和版本化；不要在第一版引入。

## 分阶段

### Phase 1：后端工具

- 实现 `spec.js` / `runner.js` / `store.js` / `run_flow.js`；
- 支持 DAG 校验、顺序、并行、取消、失败策略和摘要返回；
- 复用现有子 agent 和审批；
- 补后端测试：环、缺依赖、重复 ID、并发上限、失败传播、abort。
- **暂不做前端蓝图**。

### Phase 2：只读蓝图

- 保存 run/step；
- 增加 SSE 事件和读取接口；
- 工具卡片显示流程摘要；
- 实现只读 `FlowGraph` 和节点详情；
- 刷新页面后能恢复流程状态。

### Phase 3：可复用流程

- 支持保存 flow 定义到数据目录；
- 支持重新运行和复制；
- 再考虑简单参数编辑；
- 暂不做拖拽式节点编辑。

### Phase 4：评估抽包

只有在前三个阶段稳定、并且外部项目确实有复用需求时，才把 `server/flows/` 抽成 npm 包：

- 核心不依赖本仓库的 `features/` / `commands/`；
- 子 agent、工具、审批、存储通过接口注入；
- 工具适配器留在本仓库或作为可选包发布。

## 验收标准

- 非法 DAG 被拒绝，并给出明确原因；
- 并行步骤不超过 `maxParallel`；
- 停止主任务后所有子步骤都停止；
- 失败节点和下游跳过逻辑正确；
- 主 agent 上下文只增加最终结论和步骤摘要；
- 完整运行记录可在刷新后读取；
- 蓝图在桌面和手机都不遮挡、不溢出；
- 不改变现有 `new_task` 的行为。

## 重新评估的时机

满足以下条件后再开始：

- 0.x 的功能面基本稳定，工具协议和 SSE 不再频繁变动；
- `new_task` 的实际使用数据表明，单次委托不够，确实需要显式多步编排；
- 前端有稳定的工具视图扩展点，不需要为 flow 单独写按工具名分发的分支；
- 确定第一版只做 JSON DAG 和只读图，不把蓝图编辑器、driver、durable execution 一起拖进来。
