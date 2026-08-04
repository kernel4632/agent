/*
工具指令集：扫描工具文件，并按会话工作区执行模型要求的工具。
utils/Tool 只负责注册、执行和停止，本文件只补齐工具自己的路径参数并保存运行任务。
调用示例：await load('D:/agent/server/tools')、await runAll(sessionID, toolCalls)。
*/
import { isAbsolute, resolve } from 'node:path'           // 引入工作区相对路径展开能力
import { store } from '../store.js'                      // 引入公开工具定义列表
import { Tool } from '../utils/tool.js'                  // 引入简洁工具注册和执行接口
import { Session } from './session.js'                   // 引入会话工作区和停止状态

const running = new Map()                                // 每个会话当前尚未结束的工具


// --- 扫描并加载工具 ---
async function load(directory) {
  const definitions = await Tool.scan(directory)         // 扫描目录并替换完整工具注册表
  running.clear()                                        // 新应用不继承上次启动的工具
  store.tools = Object.entries(definitions).map(([name, definition]) => ({ name, description: definition.description, inputSchema: structuredClone(definition.parameters) })) // store 保持原公开结构
  return list()                                          // 反馈本次扫描结果
}


// --- 列出公开工具信息 ---
function list() {
  return structuredClone(store.tools)                    // 调用方不能修改启动工具定义
}


// --- 构建 LLM 工具定义 ---
function definitions() {
  return Tool.definitions()                              // 返回当前应用的全部 AI SDK 工具结构
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
  if (!session) return { result: toolResult(toolCall, 'session not found', true), stop: false } // 会话删除后不再执行外部动作

  const input = structuredClone(toolCall.input)          // 工具获得独立输入，路径展开不修改模型消息
  try {
    if (toolCall.toolName === 'shell' || typeof input.path === 'string') {
      const path = Session.path(sessionID)                // 只有使用路径的工具需要读取会话工作区
      if (input.path === undefined) input.path = path     // Shell 默认在当前工作区执行
      else if (!isAbsolute(input.path)) input.path = resolve(path, input.path) // 相对工具路径从工作区展开
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error) // 工作区损坏使用稳定错误文本
    return { result: toolResult(toolCall, message, true), stop: false } // 路径无法展开时不执行外部动作
  }

  session.abortController?.signal.throwIfAborted()       // stop 已触发时不能迟到启动外部动作
  const tool = Tool.execute(toolCall.toolName, input)    // 按名称和工具自己的输入启动执行
  const tools = running.get(sessionID) ?? new Set()      // 读取或创建当前会话工具集合
  tools.add(tool)                                        // stop 可以调用每个工具的 abort
  running.set(sessionID, tools)                          // 保存当前会话工具集合
  try {
    const value = await tool.result                      // 等待完整工具输出
    return { result: toolResult(toolCall, value.output, value.isError), stop: value.stop } // 转成 AI SDK 工具结果和 Agent 控制信号
  } finally {
    tools.delete(tool)                                   // 无论成功失败都清除当前工具
    if (tools.size === 0) running.delete(sessionID)      // 最后一个工具结束后释放集合
  }
}


// --- 创建 AI SDK 工具结果 ---
function toolResult(toolCall, output, isError) {
  const outputType = isError ? (typeof output === 'string' ? 'error-text' : 'error-json') : (typeof output === 'string' ? 'text' : 'json') // 按真实值和错误状态选择 SDK 输出类型
  return { type: 'tool-result', toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, output: { type: outputType, value: output } } // 直接符合 AI SDK ToolResultPart
}


// --- 停止全部工具 ---
async function stopAll(sessionID) {
  const session = await Session.getMutable(sessionID)    // 读取会话当前工具任务
  if (!session) return                                   // 会话已删除时无需停止
  const tools = [...(running.get(sessionID) ?? [])]      // 快照当前会话全部工具
  for (const tool of tools) tool.abort()                 // 每个工具自行响应统一停止信号
  await Promise.allSettled(tools.map((tool) => tool.result)) // 等待全部工具结束
  running.delete(sessionID)                              // 清除当前会话工具任务
}


export { load, list, definitions, runAll, stopAll }       // 导出工具扫描、定义、执行和停止动作
