/*
工具指令集：把工具定义和运行任务接入 store，并并行执行模型要求的工具。
utils/Tool 负责注册和执行，本文件只联动 store 和转换模型结果。
调用示例：await load('D:/agent/server/tools')、await run(sessionID, toolCalls)。
*/
import { store } from '../store.js'                      // 引入 LLM 工具定义和会话运行数据
import { Tool } from '../utils/tool.js'                  // 引入简洁工具注册和执行接口
import { errorMessage } from '../utils/error.js'         // 引入错误消息安全提取
import { Session } from './session.js'                   // 引入会话运行数据


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
    return { results: toolCalls.map((toolCall) => result(toolCall, errorMessage(error), true)), shouldStop: false } // 不执行外部动作
  }
  const outcomes = await Promise.all(toolCalls.map((toolCall) => execute(session, toolCall))) // 同轮工具全部同时执行
  return {
    results: outcomes.map((outcome) => outcome.result),  // 结果保持模型调用顺序
    shouldStop: outcomes.some((outcome) => outcome.stop), // 任一 finish 结果都结束 Agent
  }
}


// --- 执行单个工具 ---
async function execute(session, toolCall) {
  const execution = Tool.execute(toolCall.toolName, toolCall.input) // 模型传什么参数就执行什么参数
  session.tools.add(execution)                           // Agent.stop 可以遍历当前会话全部 execution
  try {
    const value = await execution.result                 // 等待完整工具输出
    return { result: result(toolCall, value.output, value.isError), stop: value.stop } // 转成 AI SDK 工具结果和 Agent 控制信号
  } finally {
    session.tools.delete(execution)                      // 无论成功失败都清除已结束 execution
  }
}


// --- 创建 AI SDK 工具结果 ---
function result(toolCall, output, isError) {
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
