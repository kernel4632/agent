/*
工具指令集：把 store.config.tools 转成 LLM 工具定义，并并行执行模型调用。
store 只保存 name、description、inputSchema；执行函数固定来自 server/tools 下的四个模块。
调用示例：Tool.forModel()、await Tool.runAll(sessionId, toolCalls)。
*/
import { dynamicTool, jsonSchema } from 'ai'            // 引入动态 JSON Schema 工具定义能力
import { store } from '../store.js'                     // 引入 LLM 工具列表和会话进程集合
import { Session } from './session.js'                  // 引入会话运行状态与工作目录
import * as fileTools from '../tools/file.js'           // 引入文件工具实现
import * as shellTools from '../tools/shell.js'         // 引入 Shell 工具实现
import * as webTools from '../tools/web.js'             // 引入 Web 工具实现
import * as agentTools from '../tools/agent.js'         // 引入 Agent 控制工具实现

const implementations = new Map(                       // 按工具名集中索引四个模块导出的实现
  [...Object.values(fileTools), ...Object.values(shellTools), ...Object.values(webTools), ...Object.values(agentTools)]
    .filter((item) => item?.name && typeof item.execute === 'function')
    .map((item) => [item.name, item]),
)


// --- 列出全部内置工具信息 ---
function list() {
  return [...implementations.values()].map(({ name, description, inputSchema }) => structuredClone({ name, description, inputSchema })) // 配置只保存发送给 LLM 的信息
}


// --- 构建本轮 LLM 工具 ---
function forModel() {
  return Object.fromEntries(store.config.tools.map((definition) => [
    definition.name,                                    // AI SDK 对象键使用工具名称
    dynamicTool({
      description: definition.description,              // 描述直接来自 store.config.tools
      inputSchema: jsonSchema(definition.inputSchema),   // JSON Schema 直接来自 store.config.tools
    }),
  ]))
}


// --- 并行执行全部工具 ---
async function runAll(id, toolCalls) {
  const outcomes = await Promise.all(toolCalls.map((toolCall) => run(id, toolCall))) // 同轮调用全部同时开始
  return {
    results: outcomes.map((outcome) => outcome.result), // 结果保持模型调用原顺序
    shouldStop: outcomes.some((outcome) => outcome.stop), // 任一 Agent 工具要求停止就结束循环
  }
}


// --- 执行单个工具 ---
async function run(id, toolCall) {
  const session = await Session.getMutable(id)           // 工具进程归属于当前会话
  if (!session) return createResult(toolCall, 'session not found', true) // 会话删除后不执行外部动作
  const definition = store.config.tools.find((item) => item.name === toolCall.toolName) // 确认该工具确实发送给了 LLM
  const implementation = implementations.get(toolCall.toolName) // 查找固定本地实现
  if (!definition || !implementation) return createResult(toolCall, `tool not found: ${toolCall.toolName}`, true) // 未声明或未实现时返回错误结果

  toolCall.status = 'running'                            // 执行开始时更新工具调用状态
  try {
    const value = await implementation.execute(toolCall.input, {
      abortSignal: session.abortController?.signal,      // 所有工具共享会话停止信号
      cwd: Session.getWorkspacePath(id),                 // 相对路径从所属工作区开始
      addProcess: (process) => session.processes.add(process), // 子进程启动后进入 store
      removeProcess: (process) => session.processes.delete(process), // 子进程结束后离开 store
    })
    toolCall.status = 'completed'                        // 成功执行完成
    return createResult(toolCall, value.output, false, value.stop) // 转换为 store 工具结果块
  } catch (error) {
    toolCall.status = 'error'                            // 单个工具失败不影响其他并行工具
    return createResult(toolCall, error.message, true)   // 将失败作为模型可读结果
  }
}


// --- 创建工具结果 ---
function createResult(toolCall, output, isError, stop = false) {
  return {
    result: { type: 'tool_result', toolCallId: toolCall.toolCallId, output, isError }, // 严格符合 store 内容块
    stop,                                               // stop 只控制 Agent，不写入 store
  }
}


// --- 停止全部工具进程 ---
async function stopAll(id) {
  const session = await Session.getMutable(id)           // 读取目标会话进程集合
  if (!session) return                                  // 会话已删除时无需清理
  const processes = [...session.processes]              // 快照防止退出回调并发修改 Set
  for (const process of processes) {
    try { process.kill() } catch {}                     // 单个进程异常不能阻止其他进程停止
  }
  await Promise.all(processes.map((process) => process.exited?.catch?.(() => {}) ?? Promise.resolve())) // 等待所有可等待进程退出
  session.processes.clear()                             // 清除全部进程引用
}


export const Tool = { list, forModel, runAll, run, stopAll } // 导出工具最小动作
