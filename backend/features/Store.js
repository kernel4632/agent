/*
落盘：一份全局配置，每个会话一份元数据和一份只增不减的历史。
数据目录是 AGENT_HOME（默认 ~/.agent），不兼容旧布局。

    ~/.agent/config.json                      整份替换
    ~/.agent/agents/<id>/meta.json            模型、思考强度、学到的比例、更新时间
    ~/.agent/agents/<id>/history.jsonl        一行一条 core 消息；只有截断时整份重写

同一会话的写入排成队，避免追加和整份重写互相打断；JSON 文件先写临时文件再改名，读的人不会读到半份。
*/

import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const EMPTY = { providers: [], models: { chat: '', compact: '' } }
const queues = new Map()

function home() {
    return process.env.AGENT_HOME || join(homedir(), '.agent')
}

function dir(id) {
    return join(home(), 'agents', id)
}

function enqueue(id, work) {
    const next = (queues.get(id) ?? Promise.resolve()).then(work, work)
    queues.set(id, next.catch(() => {}))
    return next
}

async function read(path, fallback) {
    try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
        if (error.code === 'ENOENT') return fallback
        throw error
    }
}

// 先写临时文件再改名：同时有人读时，读到的要么是旧的整份、要么是新的整份，不会读到写了一半的空文件。
async function write(path, data) {
    await mkdir(join(path, '..'), { recursive: true })
    const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(temp, JSON.stringify(data, null, 2) + '\n')
    await rename(temp, path)
}

export const Store = {
    home,

    // 读全局配置；文件不存在就写出一份空配置再返回。
    async config() {
        const path = join(home(), 'config.json')
        const data = await read(path, null)
        if (data) return data
        await write(path, EMPTY)
        return { ...EMPTY, models: { ...EMPTY.models } }
    },

    // 整份替换 config.json。
    async configure(data) {
        await write(join(home(), 'config.json'), data)
        return data
    },

    // 确保会话目录存在。
    async ensure(id) {
        await mkdir(dir(id), { recursive: true })
    },

    async meta(id) {
        return read(join(dir(id), 'meta.json'), {})
    },

    // 合并写入 meta.json，并更新 updatedAt。
    // 和历史写入同一条队列，两次 touch 不会互相覆盖对方的字段。
    touch(id, patch) {
        return enqueue(`meta:${id}`, async () => {
            await Store.ensure(id)
            const meta = { ...await Store.meta(id), ...patch, updatedAt: Date.now() }
            await write(join(dir(id), 'meta.json'), meta)
            return meta
        })
    },

    async history(id) {
        const path = join(dir(id), 'history.jsonl')
        let text = ''
        try { text = await readFile(path, 'utf8') } catch (error) {
            if (error.code === 'ENOENT') return []
            throw error
        }
        return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
    },

    // 往 history.jsonl 追加一条已写入 core 的消息。
    appendHistory(id, message) {
        return enqueue(id, async () => {
            await Store.ensure(id)
            await appendFile(join(dir(id), 'history.jsonl'), JSON.stringify(message) + '\n')
        })
    },

    // 整份重写历史（只在截断时调用；与 appendHistory 共用同一条队列）。
    rewriteHistory(id, history) {
        return enqueue(id, async () => {
            await Store.ensure(id)
            const text = history.map(message => JSON.stringify(message)).join('\n')
            await writeFile(join(dir(id), 'history.jsonl'), text ? text + '\n' : '')
        })
    },

    // 列出已有会话 id（agents 目录下的子目录名）。
    async list() {
        try { return (await readdir(join(home(), 'agents'), { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort() }
        catch (error) { if (error.code === 'ENOENT') return []; throw error }
    },

    // 删掉一个会话的全部文件。
    async remove(id) {
        return enqueue(id, () => rm(dir(id), { recursive: true, force: true }))
    },
}
