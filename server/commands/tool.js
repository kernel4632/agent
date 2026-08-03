/*
工具指令集：扫描工具文件，并为每个会话注入工作区、停止信号和运行任务集合。
实际工具注册、输出归一和中止动作由 utils/Tool 完成，本文件只连接工具与 Agent 业务状态。
调用示例：await Tool.load('D:/agent/server/tools')、await Tool.runAll(sessionID, toolCalls)。
*/
import { store } from '../store.js'                      // 引入公开工具定义列表
import { createToolResult } from '../utils/message.js'   // 引入纯工具结果格式
import { Tool as ToolRuntime } from '../utils/tool.js'   // 引入工具注册、执行和中止封装
import { Session } from './session.js'                   // 引入会话工作区和停止状态

const runningTools = new Map()                           // 每个会话当前由 utils 执行的工具任务


// --- 扫描并加载工具 ---
async function load(directory) {
  const definitions = await ToolRuntime.scan(directory)  // utils 扫描目录并替换完整工具注册表
  runningTools.clear()                                   // 新应用不继承上次启动的工具任务
  store.tools = Object.entries(definitions).map(([name, definition]) => ({ name, description: definition.description, inputSchema: structuredClone(definition.parameters) })) // store 保持原公开结构
  return list()                                          // 反馈本次扫描结果
}


// --- 列出公开工具信息 ---
function list() {
  return structuredClone(store.tools)                    // 调用方不能修改启动工具定义
}


// --- 构建 LLM 工具定义 ---
function definitions() {
  return ToolRuntime.definitions()                       // utils 返回当前应用的全部 AI SDK 工具结构
}


// --- 并行执行全部工具 ---
async function runAll(sessionID, toolCalls) {
  const outcomes = await Promise.all(toolCalls.map((toolCall) => run(sessionID, toolCall))) // 同轮工具全部同时执行
  return {
    results: outcomes.map((outcome) => outcome.result),  // 结果保持模型调用顺序
    shouldStop: outcomes.some((outcome) => outcome.stop), // 任一 finish 结果都结束 Agent
  }
}


// --- 执行单个工具 ---
async function run(sessionID, toolCall) {
  const session = await Session.getMutable(sessionID)    // 工具运行状态归属于当前会话
  if (!session) return { result: createToolResult(toolCall, 'session not found', true), stop: false } // 会话删除后不再执行外部动作

  let context
  try {
    context = {                                          // command 集中提供工具需要的业务上下文
      abortSignal: session.abortController?.signal,      // 所有工具共享会话停止信号
      cwd: Session.getWorkspacePath(sessionID),          // 相对路径从所属工作区开始
      addProcess: (childProcess) => session.processes.add(childProcess), // Shell 进程进入会话集合
      removeProcess: (childProcess) => session.processes.delete(childProcess), // Shell 结束后离开集合
    }
  } catch (error) {
    return { result: createToolResult(toolCall, ToolRuntime.errorText(error), true), stop: false } // 工作区损坏作为工具错误反馈
  }

  toolCall.status = 'running'                            // store 记录工具已经开始
  const execution = ToolRuntime.execute(toolCall, context) // utils 读取调用参数并统一执行结果
  const sessionTools = runningTools.get(sessionID) ?? new Set() // 读取或创建当前会话工具集合
  sessionTools.add(execution)                            // stop 可以中止 utils 包装任务
  runningTools.set(sessionID, sessionTools)              // 保存当前会话工具集合
  try {
    const value = await execution.result                 // 等待完整工具输出
    toolCall.status = value.isError ? 'error' : 'completed' // 结果状态同步回助手消息
    return { result: createToolResult(toolCall, value.output, value.isError), stop: value.stop } // 转成 store 工具结果和 Agent 控制信号
  } finally {
    sessionTools.delete(execution)                       // 无论成功失败都清除包装任务
    if (sessionTools.size === 0) runningTools.delete(sessionID) // 最后一个任务结束后释放集合
  }
}


// --- 停止全部工具 ---
async function stopAll(sessionID) {
  const session = await Session.getMutable(sessionID)    // 读取会话当前工具任务
  if (!session) return                                   // 会话已删除时无需停止
  const executions = [...(runningTools.get(sessionID) ?? [])] // 快照当前 utils 包装任务
  const childProcesses = [...session.processes]          // 快照当前 Shell 子进程
  for (const execution of executions) execution.abort() // utils 统一中止流式输出和包装任务
  for (const childProcess of childProcesses) {
    try { childProcess.kill() } catch {}                 // 单个进程异常不能阻止其他进程停止
  }
  await Promise.allSettled([...executions.map((execution) => execution.result), ...childProcesses.map((childProcess) => childProcess.exited)]) // 等待工具和进程全部结束
  runningTools.delete(sessionID)                         // 清除当前会话工具任务
  session.processes.clear()                              // 清除全部运行任务引用
}


export const Tool = { load, list, definitions, runAll, stopAll } // 导出工具扫描、定义、执行和停止动作
