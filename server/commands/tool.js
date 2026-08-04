/*
工具指令集：把工具定义和运行任务接入 store，并按会话工作区执行模型要求的工具。
utils/Tool 负责注册和执行，本文件只联动 store、补齐路径并转换模型结果。
调用示例：await load('D:/agent/server/tools')、await run(sessionID, toolCalls)。
*/
import { isAbsolute, resolve } from 'node:path'           // 引入工作区相对路径展开能力
import { store } from '../store.js'                      // 引入 LLM 工具定义和会话运行数据
import { Tool } from '../utils/tool.js'                  // 引入简洁工具注册和执行接口
import { Session } from './session.js'                   // 引入会话和工作区数据


// --- 扫描并加载工具 ---
async function load(directory) {
  store.tools = await Tool.scan(directory)               // 扫描结果直接成为 LLM 使用的工具定义
  return list()                                          // 反馈本次扫描结果
}


// --- 列出 LLM 工具定义 ---
function list() {
  return structuredClone(store.tools)                    // 调用方不能修改 store 中的工具定义
}


// --- 并行执行全部工具 ---
async function run(sessionID, toolCalls) {
  let session                                             // 当前会话直接保存本轮 execution
  try { session = Session.get(sessionID) ?? await Session.load(sessionID) } // 工具明确从缓存或文件读取会话
  catch (error) {
    const message = error instanceof Error ? error.message : String(error) // 会话错误转成工具结果
    return { results: toolCalls.map((toolCall) => toolResult(toolCall, message, true)), shouldStop: false } // 不执行外部动作
  }
  const outcomes = await Promise.all(toolCalls.map((toolCall) => execute(session, toolCall))) // 同轮工具全部同时执行
  return {
    results: outcomes.map((outcome) => outcome.result),  // 结果保持模型调用顺序
    shouldStop: outcomes.some((outcome) => outcome.stop), // 任一 finish 结果都结束 Agent
  }
}


// --- 执行单个工具 ---
async function execute(session, toolCall) {
  const input = structuredClone(toolCall.input)          // 工具获得独立输入，路径展开不修改模型消息
  try {
    if (toolCall.toolName === 'shell' || typeof input.path === 'string') {
      const workspace = Object.values(store.workspaces).find((item) => item.sessions.some((summary) => summary.id === session.id)) // 通过摘要确定会话工作区
      if (!workspace) throw Object.assign(new Error('session workspace not found'), { status: 409 }) // 归属损坏时禁止回退到服务端目录
      const path = workspace.path                         // 工具只使用明确登记的工作区
      if (input.path === undefined) input.path = path     // Shell 默认在当前工作区执行
      else if (!isAbsolute(input.path)) input.path = resolve(path, input.path) // 相对工具路径从工作区展开
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error) // 工作区损坏使用稳定错误文本
    return { result: toolResult(toolCall, message, true), stop: false } // 路径无法展开时不执行外部动作
  }

  session.abortController?.signal.throwIfAborted()       // stop 已触发时不能迟到启动外部动作
  const execution = Tool.execute(toolCall.toolName, input) // 按名称和工具自己的输入启动执行
  session.tools.add(execution)                           // Agent.stop 可以遍历当前会话全部 execution
  try {
    const value = await execution.result                 // 等待完整工具输出
    return { result: toolResult(toolCall, value.output, value.isError), stop: value.stop } // 转成 AI SDK 工具结果和 Agent 控制信号
  } finally {
    session.tools.delete(execution)                      // 无论成功失败都清除已结束 execution
  }
}


// --- 创建 AI SDK 工具结果 ---
function toolResult(toolCall, output, isError) {
  const outputType = isError ? (typeof output === 'string' ? 'error-text' : 'error-json') : (typeof output === 'string' ? 'text' : 'json') // 按真实值和错误状态选择 SDK 输出类型
  return { type: 'tool-result', toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, output: { type: outputType, value: output } } // 直接符合 AI SDK ToolResultPart
}


// --- 停止全部工具 ---
async function stop(sessionID) {
  const session = store.sessions[sessionID]              // 只停止已经加载并运行的会话
  if (!session) return                                   // 未加载会话不可能有运行工具
  const executions = [...session.tools]                  // 快照当前会话全部运行任务
  for (const execution of executions) execution.abort() // 每个 execution 自行响应停止信号
  await Promise.allSettled(executions.map((execution) => execution.result)) // 等待全部工具结束
}


export { load, list, run, stop }                          // 导出工具加载、运行和停止指令
