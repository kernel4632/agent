/*
配置指令集：加载、读取、合并并保存模型供应商配置。
工具由 Tool.load 在启动时扫描，既不读取也不写入 config.json。
调用示例：await Config.load('C:/Users/me/.agent/config.json')、await Config.update({ provider: { key: 'sk-...' } })。
*/
import { mkdir } from 'node:fs/promises'              // 引入首次运行时创建配置目录的能力
import { dirname } from 'node:path'                   // 引入配置文件父目录定位能力
import { store } from '../store.js'                   // 引入唯一配置数据
import { writeJSON } from '../utils/json.js'          // 引入完整 JSON 文件替换能力

let configPath = ''                                   // 保存当前进程使用的配置文件位置
let lastConfigUpdate = Promise.resolve()              // 后一个配置修改等待前一个修改完成


// --- 加载配置 ---
async function load(filePath) {
  configPath = filePath                               // 后续保存始终写回同一个文件
  lastConfigUpdate = Promise.resolve()               // 新应用实例不等待旧配置目录的修改
  await mkdir(dirname(configPath), { recursive: true }) // 首次启动时创建 .agent 目录
  const file = Bun.file(configPath)                   // 定位配置文件
  const saved = await file.exists() ? await file.json() : {} // 文件不存在时使用空配置
  const candidate = completeConfig(saved)             // 补齐 provider 并自然忽略旧版工具字段
  validate(candidate)                                 // 损坏供应商配置不能进入 store 或无限模型重试
  await save(candidate)                               // 首次运行和缺省字段补齐后写回磁盘
  store.config = candidate                            // 写盘成功后提交全局配置
  return get()                                        // 返回独立副本供启动流程使用
}


// --- 读取配置 ---
function get() {
  return structuredClone(store.config)               // 防止路由绕过 Config.update 修改全局数据
}


// --- 更新配置 ---
function update(partialConfig = {}) {
  const changes = structuredClone(partialConfig)      // 调用方后续修改请求体不能影响排队内容
  const currentUpdate = lastConfigUpdate.then(() => applyUpdate(changes)) // 排到前一修改之后再读取最新配置
  lastConfigUpdate = currentUpdate.catch(() => {})    // 单次失败不能阻塞后续合法修改
  return currentUpdate                                // 返回当前修改自己的完成结果
}


// --- 提交配置修改 ---
async function applyUpdate(partialConfig) {
  validateChanges(partialConfig)                      // 配置边界只接受 provider 修改
  const candidate = {                                  // 在独立候选值中合并供应商字段
    provider: { ...store.config.provider, ...structuredClone(partialConfig.provider ?? {}) },
  }
  validate(candidate)                                 // 无效 provider 保持现有配置不变
  await save(candidate)                               // 候选配置先持久化
  store.config = candidate                            // 写盘成功后替换全局配置
  return get()                                        // 返回修改后的完整配置
}


// --- 保存配置 ---
async function save(value = store.config) {
  if (!configPath) throw new Error('configuration has not been loaded') // 未加载时没有合法写入位置
  await writeJSON(configPath, value)                   // 使用完整文件替换保存配置
}


// --- 验证最小配置结构 ---
function validate(config) {
  if (!isPlainObject(config) || Object.keys(config).some((key) => key !== 'provider')) throw businessError(400, 'config may only contain provider') // 工具和其他领域不能写入配置
  const provider = config?.provider                   // 读取严格的单个供应商配置
  if (!isPlainObject(provider)) throw businessError(400, 'config.provider must be an object') // provider 不能增加集合层级
  if (typeof provider.api !== 'string' || typeof provider.key !== 'string') throw businessError(400, 'provider api and key must be strings') // 网络参数必须是字符串
  if (!Array.isArray(provider.models) || provider.models.some((model) => typeof model !== 'string')) throw businessError(400, 'provider models must be a string list') // 模型必须是名称列表
}


// --- 补齐加载配置 ---
function completeConfig(saved) {
  if (!isPlainObject(saved)) return saved               // 损坏根数据交给 validate 明确拒绝
  const defaults = { api: '', key: '', models: [] }    // 未配置供应商时使用最小空值
  if (saved.provider === undefined) return { provider: defaults } // 首次运行补齐完整 provider
  if (!isPlainObject(saved.provider)) return { provider: saved.provider } // 损坏 provider 保留给 validate 报错
  return { provider: { ...defaults, ...structuredClone(saved.provider) } } // 只读取当前配置领域
}


// --- 验证配置修改范围 ---
function validateChanges(changes) {
  if (!isPlainObject(changes) || Object.keys(changes).some((key) => key !== 'provider')) throw businessError(400, 'config may only contain provider') // 工具和其他领域不能通过配置修改
  if (changes.provider !== undefined && !isPlainObject(changes.provider)) throw businessError(400, 'config.provider must be an object') // 部分 provider 也必须是普通对象
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
