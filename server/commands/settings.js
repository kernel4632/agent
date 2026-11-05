/*
 * 设置指令：配置读写、模型测试、工具目录。
 *
 * 配置读取、当前形状检查和保存都在 features/config.js；工具扫描在 features/tool.js。
 * 两边都是设置页要的数据，所以合成一个命令文件，不再为工具目录单独留一个转手文件。
 * 本文件只 import features，不 import 别的命令；有状态模块的装配在 server.js。
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
import Config from '../features/config.js'
import Tool from '../features/tool.js'

const packageFile = fileURLToPath(new URL('../package.json', import.meta.url))
// 进程启动时读一次版本并固定下来；之后 package.json 再变，health 才能对比出“代码已更新但进程未重启”。
const runtimeVersion = await Bun.file(packageFile).json().then(config => config.version).catch(() => '')
let cachedVersion = runtimeVersion || null

// --- 配置读写与界面元数据：直接交给 feature，不在这里转手处理 ---
const { MODELS, read, set, get, meta } = Config

// --- 工具目录：设置页画权限开关用 ---
const listTools = () => Tool.list()
const toolKinds = () => Tool.KINDS

// --- 真实试一次模型请求 ---
const test = async ({ provider, model } = {}) => Agent.testModel({ provider, model })

const backups = () => Config.backups()
const readBackup = id => Config.readBackup(id)
const restore = body => Config.restore(body)
const exportConfig = query => Config.export(query)
const importConfig = body => Config.import(body)

// --- 读取后端版本：运行版本在进程启动时固定，目标版本每次读仓库文件 ---
const version = async () => {
    cachedVersion ??= (await Bun.file(packageFile).json()).version
    return cachedVersion
}

const targetVersion = async () => {
    try {
        return (await Bun.file(packageFile).json()).version
    } catch {
        return version()
    }
}

const health = async () => {
    const running = await version()
    const target = await targetVersion()
    return {
        ok: true,
        version: running,
        targetVersion: target,
        restartRequired: Boolean(running && target && running !== target),
        sessions: 0,
        running: 0,
    }
}

export default { MODELS, read, set, get, meta, test, version, targetVersion, health, listTools, toolKinds, backups, readBackup, restore, exportConfig, importConfig }
