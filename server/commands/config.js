/*
配置指令集：加载、读取、合并并保存模型供应商和提示词配置。
工具由 Tool.scan 在启动时扫描，既不读取也不写入 config.json。
调用示例：await Config.load('C:/Users/me/.agent/config.json')、await Config.update({ prompts: { system: '你是编程助手' } })。
*/
import { mkdir } from 'node:fs/promises'              // 引入首次运行时创建配置目录的能力
import { dirname } from 'node:path'                   // 引入配置文件父目录定位能力
import { Mutex } from 'async-mutex'                   // 引入互斥锁保证配置修改串行
import { store } from '../store.js'                   // 引入唯一配置数据
import { File } from '../utils/file.js'                // 引入完整文件替换能力

let configPath = ''                                   // 保存当前进程使用的配置文件位置
const mutex = new Mutex()                             // 配置修改互斥：后一个修改等前一个完成


// --- 加载配置 ---
async function load(filePath) {
  configPath = filePath                               // 后续保存始终写回同一个文件
  await mkdir(dirname(configPath), { recursive: true }) // 首次启动时创建 .agent 目录
  const file = Bun.file(configPath)                   // 定位配置文件
  const exists = await file.exists()                  // 记录是否需要创建配置文件
  const candidate = exists ? await file.json() : structuredClone(store.config) // 首次启动复制 store 中的唯一默认配置
  if (!exists) await save(candidate)                  // 首次运行只写入一份默认配置
  store.config = candidate                            // 加载成功后提交全局配置
  return get()                                        // 返回独立副本供启动流程使用
}


// --- 读取配置 ---
function get() {
  return structuredClone(store.config)               // 防止路由绕过 Config.update 修改全局数据
}


// --- 更新配置 ---
function update(partialConfig = {}) {
  const changes = structuredClone(partialConfig)      // 调用方后续修改请求体不能影响排队内容
  return mutex.runExclusive(async () => {             // 互斥保证并发修改按顺序合并
    const candidate = {
      provider: { ...store.config.provider, ...structuredClone(changes.provider ?? {}) },
      prompts: { ...store.config.prompts, ...structuredClone(changes.prompts ?? {}) },
    }
    await save(candidate)                             // 候选配置先持久化
    store.config = candidate                          // 写盘成功后替换全局配置
    return get()                                      // 返回修改后的完整配置
  })
}


// --- 保存配置 ---
async function save(value = store.config) {
  if (!configPath) throw new Error('configuration has not been loaded') // 未加载时没有合法写入位置
  await File.write(configPath, `${JSON.stringify(value, null, 2)}\n`) // 配置自行序列化后完整替换文件
}


export const Config = { load, get, update, save }       // 导出配置的全部最小动作
