/*
 * 能力管理指令：本机 MCP 与技能的识别、导入和日常维护。
 *
 * 识别是只读的；管理动作只写本应用自己的配置和技能目录，外部软件的文件不改。
 * 三个 feature 的分工：
 *   - discover：扫描本机其他软件的 MCP 配置
 *   - mcp：配置里的服务增删改、连接测试
 *   - skills：技能目录、启用状态、增改删
 * 命令层只做请求参数校验和组合，不自己读写文件。
 *
 * 调用示例：
 *   await Capabilities.mcpList({ cwd })
 *   await Capabilities.mcpImport({ ids: ['cursor::github'] })
 *   await Capabilities.skillSave({ name: 'review', description: '审查', body: '...' })
 */

import Discover from '../features/discover.js'
import Mcp from '../features/mcp.js'
import Skills from '../features/skills.js'
import fail from '../utils/fail.js'

// --- MCP：已配置的服务 + 本机识别结果；已配置名单由这里从 mcp feature 取，discover 不依赖兄弟 feature ---
const mcpList = async ({ cwd } = {}) => ({
    servers: Mcp.list(),
    detected: await Discover.mcp({ cwd: cwd || process.cwd(), configuredNames: Mcp.list().map(item => item.name) }),
})

// --- 手动新增或替换一个服务 ---
const mcpSave = async ({ name, definition } = {}) => Mcp.save({ name, definition })

// --- 按识别编号导入；名称已经存在时不覆盖，避免覆盖用户自己的配置 ---
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
        if (!found) {
            skipped.push({ id, reason: 'missing' })
            continue
        }
        if (configured.has(found.name)) {
            skipped.push({ id, name: found.name, reason: 'exists' })
            continue
        }
        await Mcp.save({ name: found.name, definition: found.definition })
        configured.add(found.name)
        imported.push(found.name)
    }
    return { imported, skipped }
}

const mcpRemove = async ({ name } = {}) => Mcp.remove({ name })
const mcpToggle = async ({ name, enabled } = {}) => Mcp.toggle({ name, enabled })
const mcpTest = async ({ name } = {}) => Mcp.test({ name })

// --- 技能：生效清单、目录、正文和增改删 ---
const skillList = async ({ cwd } = {}) => Skills.list({ cwd: cwd || process.cwd() })
const skillRead = async ({ name, cwd } = {}) => Skills.read({ name, cwd: cwd || process.cwd() })
const skillSave = async body => Skills.save(body || {})
const skillRemove = async body => Skills.remove(body || {})
const skillToggle = async body => Skills.toggle(body || {})
const skillSource = async body => Skills.source(body || {})

export default {
    mcpList,
    mcpSave,
    mcpImport,
    mcpRemove,
    mcpToggle,
    mcpTest,
    skillList,
    skillRead,
    skillSave,
    skillRemove,
    skillToggle,
    skillSource,
}
