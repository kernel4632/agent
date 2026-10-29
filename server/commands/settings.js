/*
 * 设置指令：配置读写、模型测试、工具目录。
 *
 * 配置读取、旧字段迁移和保存都在 features/config.js；工具扫描在 features/tool.js。
 * 两边都是设置页要的数据，所以合成一个命令文件，不再为工具目录单独留一个转手文件。
 * 本文件只 import features，不 import 别的命令；有状态 feature 的服务在这里 bind。
 *
 * 调用示例：
 *   await Settings.read()
 *   Settings.get()
 *   await Settings.set({ providers: [], permission: { '*': 'ask' } })
 *   await Settings.test({ provider: 'local', model: 'qwen3' })
 *   await Settings.listTools()
 *   Settings.toolKinds()
 */

import { fileURLToPath } from 'node:url'
import Agent from '../features/agent.js'
import Approval from '../features/approval.js'
import Config from '../features/config.js'
import Context from '../features/context.js'
import History from '../features/history.js'
import Mcp from '../features/mcp.js'
import Tool from '../features/tool.js'

// --- 设置入口也要把 Agent 需要的服务接起来；命令文件之间不互相 import ---
Tool.bind({ mcp: Mcp })
Approval.bind({ tool: Tool, config: Config })
Agent.bind({ history: History, tool: Tool, approval: Approval, context: Context })

const packageFile = fileURLToPath(new URL('../package.json', import.meta.url))
let cachedVersion = null

// --- 配置读写与界面元数据：直接交给 feature，不在这里转手处理 ---
const { MODELS, read, set, get, meta } = Config

// --- 工具目录：设置页画权限开关用 ---
const listTools = () => Tool.list()
const toolKinds = () => Tool.KINDS

// --- 真实试一次模型请求 ---
const test = async ({ provider, model } = {}) => Agent.testModel({ provider, model })

// --- 读取后端版本 ---
const version = async () => {
    cachedVersion ??= (await Bun.file(packageFile).json()).version
    return cachedVersion
}

export default { MODELS, read, set, get, meta, test, version, listTools, toolKinds }
