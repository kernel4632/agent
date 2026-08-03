/*
配置指令集：加载、读取、合并并保存模型与工具配置。
store.config.tools 是发送给 LLM 的完整工具信息列表，每项包含 name、description 和 inputSchema。
调用示例：await Config.load('C:/Users/me/.agent/config.json')、await Config.update({ provider: { key: 'sk-...' } })。
*/
import { mkdir } from 'node:fs/promises'              // 引入首次运行时创建数据目录的能力
import { dirname } from 'node:path'                   // 引入配置文件父目录定位能力
import { store } from '../store.js'                   // 引入唯一配置数据
import { Tool } from './tool.js'                      // 引入内置工具的 LLM 定义

let configPath = ''                                   // 保存当前进程使用的配置文件位置


// --- 加载配置 ---
async function load(filePath) {
  configPath = filePath                               // 后续保存始终写回同一个文件
  await mkdir(dirname(configPath), { recursive: true }) // 首次启动时创建 .agent 目录
  const file = Bun.file(configPath)                   // 定位配置文件
  const saved = await file.exists() ? await file.json() : {} // 文件不存在时使用空配置

  const candidate = mergeConfig({                     // 只补齐最小配置结构
    provider: { api: '', key: '', models: [] },       // 未配置模型时保持空值
    tools: Tool.list(),                               // 首次运行默认注册全部内置工具信息
  }, saved)
  validate(candidate)                                 // 损坏配置不能进入 store 或无限模型重试
  await save(candidate)                               // 首次运行和缺省字段补齐后写回磁盘
  store.config = candidate                            // 写盘成功后提交全局配置
  return get()                                        // 返回独立副本供启动流程使用
}


// --- 读取配置 ---
function get() {
  return structuredClone(store.config)               // 防止路由绕过 Config.update 修改全局数据
}


// --- 更新配置 ---
async function update(partialConfig = {}) {
  const candidate = mergeConfig(store.config, partialConfig) // 在独立候选值中递归合并配置
  validate(candidate)                                 // 无效 provider 或工具列表保持现有配置不变
  await save(candidate)                               // 候选配置先持久化
  store.config = candidate                            // 写盘成功后替换全局配置
  return get()                                        // 返回修改后的完整配置
}


// --- 保存配置 ---
async function save(value = store.config) {
  if (!configPath) throw new Error('configuration has not been loaded') // 未加载时没有合法写入位置
  await Bun.write(configPath, `${JSON.stringify(value, null, 2)}\n`) // 保存调用方确认的完整配置
}


// --- 验证最小配置结构 ---
function validate(config) {
  const provider = config?.provider                   // 读取严格的单个供应商配置
  if (!isPlainObject(provider)) throw businessError(400, 'config.provider must be an object') // provider 不能增加集合层级
  if (typeof provider.api !== 'string' || typeof provider.key !== 'string') throw businessError(400, 'provider api and key must be strings') // 网络参数必须是字符串
  if (!Array.isArray(provider.models) || provider.models.some((model) => typeof model !== 'string')) throw businessError(400, 'provider models must be a string list') // 模型必须是名称列表
  if (!Array.isArray(config.tools)) throw businessError(400, 'config.tools must be a list') // 工具必须保持设计规定的列表形状

  const names = new Set()                              // 工具名称不能重复覆盖 AI SDK 对象键
  for (const definition of config.tools) {
    const isValid = isPlainObject(definition)
      && typeof definition.name === 'string'
      && typeof definition.description === 'string'
      && isPlainObject(definition.inputSchema)
    if (!isValid) throw businessError(400, 'each tool must contain name, description and inputSchema') // 每项必须是完整 LLM 工具信息
    if (names.has(definition.name)) throw businessError(400, 'tool names must be unique') // 重名会让发送和执行定义不一致
    names.add(definition.name)                          // 记录已经出现的工具名称
  }
}


// --- 合并配置对象 ---
function mergeConfig(current, changes) {
  if (!isPlainObject(current) || !isPlainObject(changes)) return structuredClone(changes) // 数组和基础值由新值整体替换
  const merged = structuredClone(current)               // 候选对象避免修改调用方数据
  for (const [key, value] of Object.entries(changes)) {
    merged[key] = isPlainObject(value) && isPlainObject(merged[key])
      ? mergeConfig(merged[key], value)                  // 嵌套配置继续递归合并
      : structuredClone(value)                           // 数组和基础值直接使用新值
  }
  return merged                                          // 反馈完整候选配置
}


// --- 判断普通对象 ---
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) // 只递归合并普通配置对象
}


// --- 创建业务错误 ---
function businessError(status, message) {
  return Object.assign(new Error(message), { status }) // 让 server.js 统一转换 HTTP 状态
}


export const Config = { load, get, update, save }       // 导出配置的全部最小动作
