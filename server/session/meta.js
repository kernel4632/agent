/*
 * 会话资料：读取和写入 meta.json。
 *
 * 消息历史由 history.js 管，两者不要混在一起。
 * 调用示例：
 *   await Meta.prepare()
 *   const meta = await Meta.read('session-1')
 *   await Meta.write({ ...meta, title: '新标题' })
 */

import { mkdir } from 'node:fs/promises'
import { writeFile } from 'atomically' // 原子替换 meta.json，避免留下半份 JSON。
import Path from '../utils/path.js'
import fail from '../utils/fail.js'

// --- 准备数据目录 ---
const prepare = async () => {
    // 首次启动时数据目录还不存在，先建出来，后面所有读写都不用再判断目录在不在。
    await mkdir(Path.root(), { recursive: true })
    await mkdir(Path.tools(), { recursive: true })
}

// --- 读取会话资料 ---
const read = async sessionId => {
    const file = Bun.file(Path.meta(sessionId))
    // 元数据不存在说明会话不存在，必须反馈 404 语义给调用方。
    if (!await file.exists()) throw fail(404, `Session not found: ${sessionId}`)
    return file.json()
}

// --- 保存会话资料 ---
const write = async meta => {
    // 先创建会话目录，再原子写入元数据，避免留下半份 JSON。
    await mkdir(Path.session(meta.id), { recursive: true })
    await writeFile(Path.meta(meta.id), JSON.stringify(meta, null, 2))
    return meta
}

export default { prepare, read, write }
