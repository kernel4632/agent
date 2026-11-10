/*
 * 管理总线：设置页和能力页用到的动作全部走 POST /admin，请求体里带 op。
 *
 * 为什么用总线而不是一堆路由：这些动作都是"给人管这个软件用的"，不是 agent 的契约。
 * 收在一条路上，基座就只剩 /agent + /session + /sse 这几条；以后要发"纯基座版"，
 * 删掉本文件和服务端那两行路由就够，不用逐条判断哪条能删。
 *
 * 例外只有 model.icon：它要给 <img src> 直接当 URL 用，所以 GET /admin?op=model.icon
 * 也接受，但只放行这一个只读 op。
 *
 * 本文件只 import features，不 import 别的命令文件。
 *
 * 调用示例：
 *   await Admin.run({ op: 'mcp.test', name: 'github' })
 *   await Admin.run({ op: 'config.set', config })
 *   await Admin.get({ op: 'model.icon', model: 'gpt-5', theme: 'dark' })
 */

import Agent from '../features/agent.js'
import Approval from '../features/approval.js'
import Config from '../features/config.js'
import Context from '../features/context.js'
import Discover from '../features/discover.js'
import Filesystem from '../features/filesystem.js'
import Mcp from '../features/mcp.js'
import ModelIcons from '../features/model-icons.js'
import SessionGroups from '../features/session-groups.js'
import Skills from '../features/skills.js'
import Storage from '../features/storage.js'
import Tool from '../features/tool.js'
import fail from '../utils/fail.js'

// --- 配置导出走原始 Response：保留下载文件名和脱敏规则 ---
const exportConfig = ({ secrets } = {}) => {
    const full = secrets === true || secrets === 1 || secrets === '1'
    return new Response(JSON.stringify(Config.export({ secrets: full }), null, 2), {
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="agent-config-${full ? 'full' : 'masked'}.json"`,
        },
    })
}

// --- 图标同样是原始响应：前端拿它当图片地址用 ---
const modelIcon = async ({ model, family, theme } = {}) => {
    const body = await ModelIcons.icon({ model, family, theme })
    if (!body) return new Response('Not found', { status: 404 })
    return new Response(body, {
        headers: {
            'content-type': 'image/svg+xml',
            'cache-control': 'public, max-age=3600',
        },
    })
}

// --- MCP 增删改后调 Config.save() 把内存配置落盘 ---
const mcpSave = async ({ name, definition } = {}) => {
    const result = await Mcp.save({ name, definition })
    await Config.save()
    return result
}

const mcpImport = async ({ ids, cwd } = {}) => {
    if (!Array.isArray(ids) || !ids.length) throw fail(400, 'ids must be a non-empty array')
    if (ids.length > 50) throw fail(400, 'at most 50 mcp servers can be imported at once')
    if (ids.some(id => typeof id !== 'string' || !id.trim())) throw fail(400, 'ids must contain server ids')
    const { servers } = await Discover.mcp({ cwd: cwd || process.cwd(), redact: false, configuredNames: Mcp.list().map(item => item.name) })
    const byId = new Map(servers.map(item => [item.id, item]))
    const configured = new Set(Mcp.list().map(item => item.name))
    const imported = []
    const skipped = []
    for (const id of ids) {
        const found = byId.get(id)
        if (!found) { skipped.push({ id, reason: 'missing' }); continue }
        if (configured.has(found.name)) { skipped.push({ id, name: found.name, reason: 'exists' }); continue }
        await Mcp.save({ name: found.name, definition: found.definition })
        await Config.save()
        configured.add(found.name)
        imported.push(found.name)
    }
    return { imported, skipped }
}

const mcpRemove = async ({ name } = {}) => { const result = await Mcp.remove({ name }); await Config.save(); return result }
const mcpToggle = async ({ name, enabled } = {}) => { const result = await Mcp.toggle({ name, enabled }); await Config.save(); return result }

// --- 配置整体替换后要重新评估挂着的审批 ---
const setConfig = async config => { const result = await Config.set(config); Approval.recheck(); return result }
const restoreConfig = async ({ id } = {}) => { const result = await Config.restore({ id }); Approval.recheck(); return result }
const importConfig = async ({ config } = {}) => { const result = await Config.import({ config }); Approval.recheck(); return result }

const OPS = {
    // --- 配置 ---
    'config.read': async () => { await Config.read(); return Config.get() },
    'config.set': ({ config } = {}) => setConfig(config ?? {}),
    'config.meta': () => Config.meta(),
    'config.export': exportConfig,
    'config.import': ({ config } = {}) => importConfig({ config }),
    'config.backup.list': () => Config.backups(),
    'config.backup.read': ({ id } = {}) => Config.readBackup(id),
    'config.restore': ({ id } = {}) => restoreConfig({ id }),
    'config.test': ({ provider, model } = {}) => Agent.test({ provider, model, context: Context }),

    // --- MCP ---
    'mcp.list': async ({ cwd } = {}) => ({
        servers: Mcp.list(),
        detected: await Discover.mcp({ cwd: cwd || process.cwd(), configuredNames: Mcp.list().map(item => item.name) }),
    }),
    'mcp.save': ({ name, definition } = {}) => mcpSave({ name, definition }),
    'mcp.import': ({ ids, cwd } = {}) => mcpImport({ ids, cwd }),
    'mcp.remove': ({ name } = {}) => mcpRemove({ name }),
    'mcp.toggle': ({ name, enabled } = {}) => mcpToggle({ name, enabled }),
    'mcp.test': ({ name } = {}) => Mcp.test({ name }),

    // --- 技能 ---
    'skill.list': ({ cwd } = {}) => Skills.list({ cwd: cwd || process.cwd() }),
    'skill.read': ({ name, cwd } = {}) => Skills.read({ name, cwd: cwd || process.cwd() }),
    'skill.save': body => Skills.save(body || {}),
    'skill.remove': body => Skills.remove(body || {}),
    'skill.toggle': body => Skills.toggle(body || {}),
    'skill.source': body => Skills.source(body || {}),

    // --- 会话存储位置 ---
    'storage.status': () => Storage.status(),
    'storage.set': ({ path } = {}) => Storage.setPath(path),
    'storage.cancel': () => Storage.cancel(),

    // --- 会话分组 ---
    'session.groups.set': ({ groups } = {}) => SessionGroups.save({ groups: groups ?? [] }),

    // --- 展示辅助 ---
    'model.family': ({ model, family } = {}) => ModelIcons.suggest({ model, family }),
    'model.icon': modelIcon,
    'fs.entries': query => Filesystem.entries({ path: query?.path, mode: query?.mode }),
    'tool.list': () => Tool.list(),
    'tool.kinds': () => Tool.KINDS,
}

// 只有这个只读 op 允许走 GET，因为它要直接当 <img src>。
const GET_OPS = new Set(['model.icon'])

const run = async body => {
    const { op, ...args } = body || {}
    const handler = OPS[op]
    if (!handler) throw fail(400, `unknown op: ${op || '(missing)'}`)
    return handler(args)
}

const get = async query => {
    const op = query?.op
    if (!GET_OPS.has(op)) throw fail(400, `only ${[...GET_OPS].join(', ')} support GET; everything else is POST /admin`)
    return OPS[op](query)
}

export default { run, get, OPS }
