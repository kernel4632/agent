/*
 * 配置指令：读取本机配置文件、替换配置、保存配置。
 *
 * 配置里既有模型服务信息，也有工具权限规则 permission，所以本文件同时管着这两件事。
 * 调用示例：
 *   await Config.read(Path.config())            // 启动时读一次
 *   Config.get().providers                      // 取当前模型服务列表
 *   Config.get().permission                     // 取工具权限规则
 *   await Config.set({ providers: [], permission: { '*': 'ask' } })  // 整体替换并保存
 *   await Config.save(Path.config())            // 只保存当前配置
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import Path from '../utils/path.js' // 提供默认配置文件路径。
import Store from '../store.js' // 直接访问程序当前使用的配置。

// --- 读取配置 ---
const read = async path => {
    // 第一次启动时配置文件还不存在，从空对象开始。
    const file = Bun.file(path)
    const config = await file.exists() ? await file.json() : {}
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Object.assign(Store.config, config)
    return config
}

// --- 替换配置 ---
const set = async newConfig => {
    // 用户提交的配置必须是对象，否则挑一个字段来覆盖是无意义的。
    if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
        throw new TypeError('config must be an object')
    }

    // 整体替换，不偷偷合并旧字段，保证用户提交的配置就是实际配置。
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Object.assign(Store.config, structuredClone(newConfig))
    return save(Path.config())
}

// --- 读取当前配置 ---
const get = () => Store.config

// --- 保存配置 ---
const save = async path => {
    await mkdir(dirname(path), { recursive: true })
    // 先写临时文件，再替换正式文件，避免程序中断留下半份 JSON。
    await writeFile(path, JSON.stringify(Store.config, null, 2))
    return Store.config
}

export default { read, set, get, save }
