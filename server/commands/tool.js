/*
工具指令集：启动时扫描 tools 目录，并把 store.tools 转成 LLM 工具定义后执行模型调用。
store 只保存 name、description、inputSchema；执行函数保留在本指令的私有索引中。
调用示例：await Tool.load('D:/agent/server/tools')、Tool.forModel()、await Tool.runAll(sessionId, toolCalls)。
*/
import { dynamicTool, jsonSchema } from 'ai'            // 引入动态 JSON Schema 工具定义能力
import { readdir, stat } from 'node:fs/promises'        // 引入工具目录扫描和版本读取能力
import { join } from 'node:path'                        // 引入工具模块路径拼接能力
import { pathToFileURL } from 'node:url'                 // 引入 Windows 路径到动态导入地址的转换能力
import { store } from '../store.js'                     // 引入 LLM 工具列表和会话进程集合
import { Session } from './session.js'                  // 引入会话运行状态与工作目录

let toolsByName = new Map()                            // 按扫描得到的工具名保存完整工具对象


// --- 扫描并加载工具 ---
async function load(directory) {
  const entries = await readdir(directory, { withFileTypes: true }) // 读取当前启动可用工具模块
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.js')).map((entry) => entry.name).sort() // 只按稳定顺序加载 JS 文件
  const modules = await Promise.all(files.map((file) => importToolModule(directory, file))) // 每次启动按当前文件版本动态导入
  const tools = modules.flatMap((module) => Object.values(module)).filter((value) => value && typeof value === 'object') // 模块导出的对象都必须是合法工具
  toolsByName = mapToolsByName(tools)                    // 校验后按名称保存本次启动的完整工具
  store.tools = list()                                   // store 只保存发给 LLM 的公开定义
  return structuredClone(store.tools)                    // 反馈本次扫描结果
}


// --- 导入当前版本工具模块 ---
async function importToolModule(directory, file) {
  const filePath = join(directory, file)                 // 定位当前扫描到的工具文件
  const fileVersion = (await stat(filePath)).mtimeMs     // 修改时间用于绕过同进程 ESM 缓存
  const url = pathToFileURL(filePath)                    // Windows 路径转换为标准模块地址
  url.searchParams.set('version', String(fileVersion))   // 文件变化后重新执行模块内容
  return import(url.href)                                // 返回该文件当前全部导出
}


// --- 校验工具并按名称整理 ---
function mapToolsByName(tools) {
  const loaded = new Map()                               // 工具名称必须在全部模块中唯一
  for (const tool of tools) {
    const isValid = typeof tool.name === 'string' && tool.name
      && typeof tool.description === 'string'
      && tool.inputSchema && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)
      && typeof tool.execute === 'function'
    if (!isValid) throw new Error('each tool must contain name, description, inputSchema and execute') // 不完整模块阻止应用带病启动
    if (loaded.has(tool.name)) throw new Error(`duplicate tool name: ${tool.name}`) // 重名会让模型定义和执行函数不确定
    loaded.set(tool.name, tool)                          // 保存经过验证的真实实现
  }
  return loaded                                          // 返回本次启动唯一工具索引
}


// --- 列出全部已加载工具信息 ---
function list() {
  return [...toolsByName.values()].map(({ name, description, inputSchema }) => structuredClone({ name, description, inputSchema })) // 只公开发送给 LLM 的工具信息
}


// --- 构建本轮 LLM 工具 ---
function forModel() {
  return Object.fromEntries(store.tools.map((definition) => [
    definition.name,                                    // AI SDK 对象键使用工具名称
    dynamicTool({
      description: definition.description,              // 描述直接来自启动扫描结果
      inputSchema: jsonSchema(definition.inputSchema),   // JSON Schema 直接来自启动扫描结果
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
  const definition = store.tools.find((item) => item.name === toolCall.toolName) // 确认该工具确实发送给了 LLM
  const tool = toolsByName.get(toolCall.toolName)        // 读取启动时加载的完整工具对象
  if (!definition || !tool) return createResult(toolCall, `tool not found: ${toolCall.toolName}`, true) // 未声明或未实现时返回错误结果

  toolCall.status = 'running'                            // 执行开始时更新工具调用状态
  try {
    const value = await tool.execute(toolCall.input, {
      abortSignal: session.abortController?.signal,      // 所有工具共享会话停止信号
      cwd: Session.getWorkspacePath(id),                 // 相对路径从所属工作区开始
      addProcess: (process) => session.processes.add(process), // 子进程启动后进入 store
      removeProcess: (process) => session.processes.delete(process), // 子进程结束后离开 store
    })
    toolCall.status = 'completed'                        // 成功执行完成
    return createResult(toolCall, value.output, false, value.stop) // 转换为 store 工具结果块
  } catch (error) {
    toolCall.status = 'error'                            // 单个工具失败不影响其他并行工具
    const message = error instanceof Error ? error.message : String(error) // 任意抛出值都转换为模型可读文本
    return createResult(toolCall, message, true)         // 将失败作为模型可读结果
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


export const Tool = { load, list, forModel, runAll, run, stopAll } // 导出工具扫描、模型转换、执行和停止动作
