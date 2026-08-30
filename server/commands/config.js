/* 
// 读配置
await Config.read(path)

// 改配置
await Config.set(newConfig)

// 保存配置
await Config.save(path)
*/

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import Path from '../utils/path.js' // 生成默认配置文件路径。
import Store from '../store.js' // 直接访问程序当前使用的配置。

// --- 读取配置 ---
const read = async path => {
    // 路径缺失时让文件系统给出清晰错误，而不是默默使用错误配置。
    if (typeof path !== 'string' || !path) throw new TypeError('path must be a non-empty string')
    const file = Bun.file(path)

    // 第一次启动时配置文件还不存在，从空对象开始。
    const config = await file.exists() ? await file.json() : {}
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Object.assign(Store.config, config)
    return config
}

// --- 替换配置 ---
const set = async newConfig => {
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
    // 保存必须有明确目标，否则无法保证配置反馈对应哪个文件。
    if (typeof path !== 'string' || !path) throw new TypeError('path must be a non-empty string')
    await mkdir(dirname(path), { recursive: true })

    // 先写临时文件，再替换正式文件，避免程序中断留下半份 JSON。
    await writeFile(path, JSON.stringify(Store.config, null, 2))
    return Store.config
}

export default { read, set, get, save }
