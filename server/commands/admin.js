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
 * 调用示例：
 *   await Admin.run({ op: 'mcp.test', name: 'github' })
 *   await Admin.run({ op: 'config.set', config })
 *   await Admin.get({ op: 'model.icon', model: 'gpt-5', theme: 'dark' })
 */

import Capabilities from './capabilities.js'
import Filesystem from './filesystem.js'
import Settings from './settings.js'
import StorageCommand from './storage.js'
import ModelIcons from '../features/model-icons.js'
import SessionGroups from '../features/session-groups.js'
import fail from '../utils/fail.js'

// 导出走原始 Response：保留下载文件名和脱敏规则，不经过 JSON 序列化。
const exportConfig = ({ secrets } = {}) => {
    const full = secrets === true || secrets === 1 || secrets === '1'
    return new Response(JSON.stringify(Settings.exportConfig({ secrets: full }), null, 2), {
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="agent-config-${full ? 'full' : 'masked'}.json"`,
        },
    })
}

// 图标同样是原始响应：前端拿它当图片地址用。
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

const OPS = {
    // --- 配置 ---
    'config.read': async () => {
        await Settings.read()
        return Settings.get()
    },
    'config.set': ({ config } = {}) => Settings.set(config ?? {}),
    'config.meta': () => Settings.meta(),
    'config.export': exportConfig,
    'config.import': ({ config } = {}) => Settings.importConfig({ config }),
    'config.backup.list': () => Settings.backups(),
    'config.backup.read': ({ id } = {}) => Settings.readBackup(id),
    'config.restore': ({ id } = {}) => Settings.restore({ id }),
    'config.test': ({ provider, model } = {}) => Settings.test({ provider, model }),

    // --- MCP ---
    'mcp.list': ({ cwd } = {}) => Capabilities.mcpList({ cwd }),
    'mcp.save': ({ name, definition } = {}) => Capabilities.mcpSave({ name, definition }),
    'mcp.import': ({ ids, cwd } = {}) => Capabilities.mcpImport({ ids, cwd }),
    'mcp.remove': ({ name } = {}) => Capabilities.mcpRemove({ name }),
    'mcp.toggle': ({ name, enabled } = {}) => Capabilities.mcpToggle({ name, enabled }),
    'mcp.test': ({ name } = {}) => Capabilities.mcpTest({ name }),

    // --- 技能 ---
    'skill.list': ({ cwd } = {}) => Capabilities.skillList({ cwd }),
    'skill.read': ({ name, cwd } = {}) => Capabilities.skillRead({ name, cwd }),
    'skill.save': body => Capabilities.skillSave(body || {}),
    'skill.remove': body => Capabilities.skillRemove(body || {}),
    'skill.toggle': body => Capabilities.skillToggle(body || {}),
    'skill.source': body => Capabilities.skillSource(body || {}),

    // --- 会话存储位置 ---
    'storage.status': () => StorageCommand.status(),
    'storage.set': ({ path } = {}) => StorageCommand.setPath({ path }),
    'storage.cancel': () => StorageCommand.cancel(),

    // --- 会话分组：保存走总线，读取由 GET /session/list 一起返回 ---
    'session.groups.set': ({ groups } = {}) => SessionGroups.save({ groups: groups ?? [] }),

    // --- 展示辅助 ---
    'model.family': ({ model, family } = {}) => ModelIcons.suggest({ model, family }),
    'model.icon': modelIcon,
    'fs.entries': query => Filesystem.entries(query || {}),
    'tool.list': () => Settings.listTools(),
    'tool.kinds': () => Settings.toolKinds(),
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

export default { OPS, run, get }
