/*
临时工作区：新会话没有指定目录时，在系统临时目录的 agent/ 下建独立文件夹。
每个会话一个目录，删除会话或切换工作区时可以安全清理；只清理本文件创建的目录。

调用示例：
  const cwd = await Scratch.create()
  await Scratch.ensure(session.cwd, session.temporary)
  await Scratch.remove(session.cwd, session.temporary)
  const copy = await Scratch.clone(sourceCwd)
*/

import { access, cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import Path from './path.js'

const PREFIX = 'session-'
const testing = process.env.NODE_ENV === 'test'
    || process.env.BUN_ENV === 'test'
    || /bun-test|\.test\.(js|ts)$/.test(process.argv[1] || '')

// 默认集中在 <系统临时目录>/agent，避免一堆 agent-session-* 散落在临时目录根部。
// 测试把临时工作区放进临时 AGENT_HOME，避免每次跑测试都往真实系统临时目录里丢会话目录。
const base = () => {
    if (process.env.AGENT_TMP) return resolve(process.env.AGENT_TMP)
    if (testing && process.env.AGENT_HOME) return join(Path.root(), 'scratch', 'agent')
    return join(tmpdir(), 'agent')
}

const exists = async path => {
    try { await access(path); return true } catch { return false }
}

const managed = path => {
    const target = resolve(String(path || ''))
    return Path.samePath(dirname(target), base()) && basename(target).startsWith(PREFIX)
}

const create = async () => {
    const root = base()
    await mkdir(root, { recursive: true })
    return mkdtemp(join(root, PREFIX))
}

const ensure = async (path, temporary) => {
    if (!temporary || !managed(path)) return
    await mkdir(path, { recursive: true }).catch(error => {
        console.warn(`[scratch] 临时工作区创建失败：${error.message}`)
    })
}

const remove = async (path, temporary) => {
    if (!temporary || !managed(path)) return
    await rm(path, { recursive: true, force: true })
}

const clone = async source => {
    const target = await create()
    try {
        if (await exists(source)) await cp(source, target, { recursive: true })
        return target
    } catch (error) {
        await rm(target, { recursive: true, force: true }).catch(() => {})
        throw error
    }
}

export default { create, ensure, remove, clone, managed, base }
