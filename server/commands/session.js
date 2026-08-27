/* 
// 创建会话
await Session.create({
    title: "写爬虫",
})
// result = { sessionId: "session-1" }

// 删除会话
await Session.remove({
    sessionId: "session-1",
})
// 读取会话
await Session.read({
    sessionId: "session-1",
})
// result = {
//     id: "session-1",
//     title: "写爬虫",
//     history: [...]
// }

// 重命名会话
await Session.rename({
    sessionId: "session-1",
    title: "写爬虫脚本",
})

// 回退会话历史
await Session.rollback({
    sessionId: "session-1",
    messageId: "message-2",     // 回退到这条消息之前
})


// 撤销上一次回退
await Session.redo({
    sessionId: "session-1",
})


// 用户主动压缩当前会话
await Session.compact({
    sessionId: "session-1",
    maxTokens: 8000,             // 压缩后的最大上下文长度
})
  */

import { mkdir, rm } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { writeFile } from 'atomically'
import Config from './config.js'
import Context from '../features/context.js'
import Compact from '../features/compact.js'
import History from '../features/history.js'
import Path from '../utils/path.js'

const readMeta = async sessionId => {
    const file = Bun.file(Path.meta(sessionId))
    if (!await file.exists()) throw new Error(`Session not found: ${sessionId}`)
    return file.json()
}

const writeMeta = async meta => {
    await mkdir(Path.session(meta.id), { recursive: true })
    await writeFile(Path.meta(meta.id), JSON.stringify(meta, null, 2))
    return meta
}

const firstModel = () => {
    const provider = (Config.get().providers || []).find(item => item.enabled !== false)
    const model = provider?.models?.[0]
    return {
        provider: provider?.name || '',
        model: typeof model === 'string' ? model : model?.id || '',
    }
}

const create = async ({ title, workspaceId, provider, model }) => {
    if (typeof title !== 'string' || !title.trim()) throw new TypeError('title must be a non-empty string')
    const selected = firstModel()
    const meta = {
        id: nanoid(),
        title: title.trim(),
        workspaceId,
        provider: provider || selected.provider,
        model: model || selected.model,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }

    await writeMeta(meta)
    await History.load({ sessionId: meta.id })
    await History.save({ sessionId: meta.id })
    return { sessionId: meta.id }
}

const read = async ({ sessionId }) => {
    const meta = await readMeta(sessionId)
    await History.load({ sessionId })
    return { ...meta, history: History.get({ sessionId }) }
}

const rename = async ({ sessionId, title }) => {
    if (typeof title !== 'string' || !title.trim()) throw new TypeError('title must be a non-empty string')
    const meta = await readMeta(sessionId)
    meta.title = title.trim()
    meta.updatedAt = Date.now()
    return writeMeta(meta)
}

const remove = async ({ sessionId }) => {
    await readMeta(sessionId)
    await rm(Path.session(sessionId), { recursive: true, force: true })
    return { ok: true }
}

const rollback = async ({ sessionId, messageId }) => {
    await readMeta(sessionId)
    await History.load({ sessionId })
    await History.rollback({ sessionId, messageId })
    await History.save({ sessionId })
    return read({ sessionId })
}

const redo = async ({ sessionId }) => {
    await readMeta(sessionId)
    await History.load({ sessionId })
    await History.redo({ sessionId })
    await History.save({ sessionId })
    return read({ sessionId })
}

const compact = async ({ sessionId, maxTokens, onText }) => {
    await readMeta(sessionId)
    await History.load({ sessionId })
    const context = Context.build({ history: History.get({ sessionId }) })
    const result = await Compact.run({
        sessionId,
        messages: context.messages,
        token: context.token,
        maxTokens,
        onText,
    })

    // Compact 返回总结消息时，写回 History；未压缩时两者仍是同一个数组。
    if (result.messages !== context.messages) {
        for (const message of result.messages) await History.add({ sessionId, message })
        await History.save({ sessionId })
    }
    return read({ sessionId })
}

export default { create, read, rename, remove, rollback, redo, compact }
