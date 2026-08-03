/*
工具指令集：扫描工具文件，并为每个会话注入工作区、停止信号和运行任务集合。
实际工具注册、输出归一和中止动作由 utils/Tool 完成，本文件只连接工具与 Agent 业务状态。
调用示例：await Tool.load('D:/agent/server/tools')、await Tool.runAll(sessionID, toolCalls)。
*/
import { readdir } from 'node:fs/promises'               // 引入启动工具文件检查能力
import { join, resolve } from 'node:path'                // 引入工具文件和绝对目录定位能力
import { pathToFileURL } from 'node:url'                 // 引入跨平台动态导入地址
import { store } from '../store.js'                      // 引入公开工具定义列表
import { Tool as ToolRuntime } from '../utils/tool.js'   // 引入工具注册、执行和中止封装
import { Session } from './session.js'                   // 引入会话工作区和停止状态

let loadedToolNames = new Set()                          // 记录本次应用实际启用的工具
const runningTools = new Map()                           // 每个会话当前由 utils 执行的工具任务


// --- 扫描并加载工具 ---
async function load(directory) {
  const entries = await readdir(directory, { withFileTypes: true }) // 检查本次启动的工具文件
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.js')).map((entry) => entry.name).sort() // 按稳定顺序读取平铺工具
  if (files.length === 0) throw new Error('tools directory contains no JavaScript tools') // 空目录不能启动无能力 Agent
  const modules = await Promise.all(files.map((file) => import(pathToFileURL(join(directory, file)).href))) // 提前读取默认导出供严格校验
  const tools = modules.flatMap((module) => Array.isArray(module.default) ? module.default : [module.default]) // 默认导出可为单工具或工具列表
  validateTools(tools)                                   // 无效或重名工具在注册前阻止启动
  await ToolRuntime.scan(resolve(directory))             // utils 负责导入默认导出并注册工具
  const definitions = ToolRuntime.definitions()          // 读取全部已注册模型定义
  const names = tools.map((tool) => tool.name)            // 只启用本次目录实际声明的工具
  loadedToolNames = new Set(names)                       // 后续执行只接受本次启动工具
  runningTools.clear()                                   // 新应用不继承上次启动的工具任务
  store.tools = names.map((name) => ({ name, description: definitions[name].description, inputSchema: structuredClone(definitions[name].parameters) })) // store 保持原公开结构
  return list()                                          // 反馈本次扫描结果
}


// --- 校验本次工具目录 ---
function validateTools(tools) {
  const names = new Set()                                // 全部文件共享唯一工具命名空间
  for (const tool of tools) {
    const isValid = tool && typeof tool.name === 'string' && tool.name
      && typeof tool.description === 'string'
      && tool.parameters && typeof tool.parameters === 'object' && !Array.isArray(tool.parameters)
      && typeof tool.execute === 'function'
    if (!isValid) throw new Error('each tool must contain name, description, parameters and execute') // 不完整工具不能注册
    if (names.has(tool.name)) throw new Error(`duplicate tool name: ${tool.name}`) // 重名会覆盖 utils 注册表
    names.add(tool.name)                                 // 登记已经验证的工具名
  }
}


// --- 列出公开工具信息 ---
function list() {
  return structuredClone(store.tools)                    // 调用方不能修改启动工具定义
}


// --- 构建 LLM 工具定义 ---
function definitions() {
  const definitions = ToolRuntime.definitions()          // utils 返回 AI SDK 所需对象结构
  return Object.fromEntries([...loadedToolNames].map((name) => [name, structuredClone(definitions[name])])) // 只发送当前应用加载的工具
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
  if (!session) return createResult(toolCall, 'session not found', true) // 会话删除后不再执行外部动作
  if (!loadedToolNames.has(toolCall.toolName)) return createResult(toolCall, `tool not found: ${toolCall.toolName}`, true) // 未在本次启动加载的工具拒绝执行

  let context
  try {
    context = {                                          // command 集中提供工具需要的业务上下文
      abortSignal: session.abortController?.signal,      // 所有工具共享会话停止信号
      cwd: Session.getWorkspacePath(sessionID),          // 相对路径从所属工作区开始
      addProcess: (childProcess) => session.processes.add(childProcess), // Shell 进程进入会话集合
      removeProcess: (childProcess) => session.processes.delete(childProcess), // Shell 结束后离开集合
    }
  } catch (error) {
    return createResult(toolCall, normalizeError(error).message, true) // 工作区损坏作为工具错误反馈
  }

  toolCall.status = 'running'                            // store 记录工具已经开始
  const input = toolCall.args ?? toolCall.input ?? {}    // 兼容 LLM 返回和 command 直接调用两种边界
  const execution = ToolRuntime.execute(toolCall.toolName, { ...input, __context: context }) // utils 执行并统一结果
  const sessionTools = runningTools.get(sessionID) ?? new Set() // 读取或创建当前会话工具集合
  sessionTools.add(execution)                            // stop 可以中止 utils 包装任务
  runningTools.set(sessionID, sessionTools)              // 保存当前会话工具集合
  try {
    const value = await execution.result                 // 等待完整工具输出
    toolCall.status = value.isError ? 'error' : 'completed' // 结果状态同步回助手消息
    const output = normalizeToolOutput(value.output, value.isError) // 保持 command 原有模型反馈格式
    return createResult(toolCall, output, value.isError, value.stop) // 转成 store 工具结果
  } finally {
    sessionTools.delete(execution)                       // 无论成功失败都清除包装任务
    if (sessionTools.size === 0) runningTools.delete(sessionID) // 最后一个任务结束后释放集合
  }
}


// --- 创建工具结果 ---
function createResult(toolCall, output, isError, stop = false) {
  return {
    result: { type: 'tool_result', toolCallId: toolCall.toolCallId, output, isError }, // 保持现有 store 内容块
    stop,                                                // stop 只控制 Agent 循环
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


// --- 还原工具错误文本 ---
function normalizeToolOutput(output, isError) {
  const prefix = '工具出错: '                            // utils 为所有抛出错误增加的统一前缀
  return isError && typeof output === 'string' && output.startsWith(prefix) ? output.slice(prefix.length) : output // command 保持原有对外文本
}


// --- 统一工具错误 ---
function normalizeError(error) {
  return error instanceof Error ? error : new Error(String(error)) // 工具边界始终使用稳定 Error
}


export const Tool = { load, list, definitions, runAll, stopAll } // 导出工具扫描、定义、执行和停止动作
