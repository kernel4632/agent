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
import Path from '../utils/path.js'

// 内存中的配置是程序当前正在使用的配置。
// read() 和 set() 会更新它，其他模块可以通过 get() 读取最新内容。
let config = {}

const read = async path => {
    const file = Bun.file(path)

    // 第一次启动时配置文件还不存在，从空对象开始。
    config = await file.exists() ? await file.json() : {}
    return config
}

const set = async newConfig => {
    if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
        throw new TypeError('config must be an object')
    }

    // 整体替换，不偷偷合并旧字段，保证用户提交的配置就是实际配置。
    config = structuredClone(newConfig)
    return save(Path.config())
}

const get = () => config

const save = async path => {
    await mkdir(dirname(path), { recursive: true })

    // 先写临时文件，再替换正式文件，避免程序中断留下半份 JSON。
    await writeFile(path, JSON.stringify(config, null, 2))
    return config
}

export default { read, set, get, save }
