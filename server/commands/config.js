/*
 * 配置指令：把 HTTP 动作接到 features/config.js 上，外加试模型和版本号。
 *
 * 读取、旧字段迁移、整体保存都在 features/config.js 里；本文件不再碰配置内容。
 * 路径、字段和状态码保持不变，界面和测试仍然从这里取 Config。
 *
 * 调用示例：
 *   await Config.read()
 *   Config.get()
 *   await Config.set({ providers: [], permission: { '*': 'ask' } })
 *   await Config.test({ provider: 'local', model: 'qwen3' })
 */

import { fileURLToPath } from 'node:url'
import Agent from '../features/agent.js'
import Config from '../features/config.js'

const packageFile = fileURLToPath(new URL('../package.json', import.meta.url))
let cachedVersion = null

// --- 配置读写与界面元数据：直接交给 feature，不在这里转手处理 ---
const { MODELS, read, set, get, meta } = Config

// --- 真实试一次模型请求 ---
const test = async ({ provider, model } = {}) => Agent.testModel({ provider, model })

// --- 读取后端版本 ---
const version = async () => {
    cachedVersion ??= (await Bun.file(packageFile).json()).version
    return cachedVersion
}

export default { MODELS, read, set, get, meta, test, version }
