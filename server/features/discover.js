/*
 * 本机识别：扫描其他软件留下的 MCP 配置，把里面的服务整理成本应用能用的形状。
 *
 * 只读，不改别人的文件。识别到不等于启用：用户在设置页确认后才通过 /mcp/import 写进自己的配置。
 * 常见来源放在 candidates 里，找不到的文件直接跳过；文件坏了只记在这条来源上，不拖垮整次扫描。
 * 返回值里的 env / headers 只给键名，值不回传；导入时按 id 重新读一遍源文件，避免前端拿到密钥。
 *
 * 调用示例：
 *   const { sources, servers } = await Discover.mcp({ cwd })
 *   const { servers } = await Discover.mcp({ cwd, redact: false })   // 导入时用原始定义
 */

import { basename, dirname, join, resolve } from 'node:path'
import store from '../store.js'
import Machine from '../utils/machine.js'
import Path from '../utils/path.js'
import Skills from '../utils/skills.js'

const FILE_LIMIT = 16 * 1024 * 1024   // 有些客户端把整个项目表写进一个文件，给足余量
const SERVER_LIMIT = 200
const FULL_SERVER_LIMIT = 500          // 整机扫描可能翻出很多份配置，给一个上限防止页面被撑爆
const ROOT_LIMIT = 5000                // 整机扫描的技能目录上限；页面自己分页
const CACHE_TTL = 5 * 60 * 1000

// 整机扫描很慢，同一次服务进程里复用结果；导入/启停只改本应用状态，不影响这份缓存。
const cache = { mcp: { at: 0, key: '', value: null }, skills: { at: 0, key: '', value: null } }
const cached = (slot, key) => cache[slot].value && cache[slot].key === key && Date.now() - cache[slot].at < CACHE_TTL
    ? cache[slot].value
    : null
const remember = (slot, key, value) => {
    cache[slot] = { at: Date.now(), key, value }
    return value
}

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const textMap = value => isObject(value)
    ? Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string'))
    : {}
const textList = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : []

// --- 传输方式：各家写法不同，归一到本应用认的 stdio / sse / http ---
const transportOf = value => {
    const type = String(value.type || value.transport || '').toLowerCase()
    if (type.includes('sse')) return 'sse'
    if (type.includes('http')) return 'http'
    if (type === 'remote') return 'http'
    if (type === 'local' || type === 'stdio') return 'stdio'
    return ''
}

// --- 把一条外部服务定义收拾成本应用的 mcp 配置项；认不出来就返回 null ---
const normalizeServer = raw => {
    if (!isObject(raw)) return null
    const env = { ...textMap(raw.env), ...textMap(raw.environment) }
    const headers = textMap(raw.headers)
    const transport = transportOf(raw)

    let command = raw.command
    let args = raw.args
    if (isObject(command)) {
        // Zed 的写法：command: { path, args, env }
        Object.assign(env, textMap(command.env))
        args = command.args ?? args
        command = command.path || command.command
    }
    if (Array.isArray(command)) {
        // opencode 的写法：command: ["bun", "run", "..."]
        args = command.slice(1)
        command = command[0]
    }

    if (typeof command === 'string' && command.trim()) {
        return {
            command: command.trim(),
            args: textList(args),
            ...(Object.keys(env).length ? { env } : {}),
            enabled: raw.enabled !== false,
        }
    }
    if (typeof raw.url === 'string' && raw.url.trim()) {
        return {
            transport: transport === 'sse' ? 'sse' : 'http',
            url: raw.url.trim(),
            ...(Object.keys(headers).length ? { headers } : {}),
            enabled: raw.enabled !== false,
        }
    }
    return null
}

// --- 回传前遮掉 env / headers 的值，只保留键名 ---
const mask = value => {
    const env = value.env || {}
    const headers = value.headers || {}
    const definition = { ...value }
    if (Object.keys(env).length) definition.env = {}
    if (Object.keys(headers).length) definition.headers = {}
    return {
        definition,
        envKeys: Object.keys(env).sort(),
        headerKeys: Object.keys(headers).sort(),
    }
}

// --- TOML 只认 Codex 配置里需要的几种写法，不追求覆盖完整 TOML ---
const parseTomlValue = text => {
    const value = text.trim()
    if (value.startsWith('"')) {
        const match = value.match(/^"((?:[^"\\]|\\.)*)"/)
        if (!match) return undefined
        try {
            return JSON.parse(`"${match[1]}"`)
        } catch {
            return undefined
        }
    }
    if (value.startsWith("'")) {
        const match = value.match(/^'([^']*)'/)
        return match ? match[1] : undefined
    }
    if (value.startsWith('[')) {
        return [...value.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(match => match[1] ?? match[2])
    }
    if (value === 'true') return true
    if (value === 'false') return false
    return undefined
}

const parseToml = text => {
    const servers = {}
    let current = null
    let inEnv = false
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const table = line.match(/^\[([^\]]+)\]$/)
        if (table) {
            const parts = table[1].split('.').map(part => part.trim().replace(/^["']|["']$/g, ''))
            if (parts[0] === 'mcp_servers' && parts[1]) {
                current = servers[parts[1]] ||= {}
                inEnv = parts[2] === 'env'
                if (inEnv) current.env ||= {}
            } else {
                current = null
                inEnv = false
            }
            continue
        }
        if (!current) continue
        const pair = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
        if (!pair) continue
        const value = parseTomlValue(pair[2])
        if (value === undefined) continue
        if (inEnv) {
            if (typeof value === 'string') current.env[pair[1]] = value
            continue
        }
        if (pair[1] === 'command') current.command = value
        if (pair[1] === 'args' && Array.isArray(value)) current.args = value
        if (pair[1] === 'enabled' && typeof value === 'boolean') current.enabled = value
    }
    return servers
}

// --- 常见客户端把 MCP 服务放在哪个文件、哪个字段 ---
const candidates = ({ cwd, home, env }) => {
    const appData = env.APPDATA || join(home, 'AppData', 'Roaming')
    const configHome = env.XDG_CONFIG_HOME || join(home, '.config')
    const mac = join(home, 'Library', 'Application Support')
    return [
        { id: 'claude-desktop', app: 'Claude Desktop', path: join(appData, 'Claude', 'claude_desktop_config.json'), key: 'mcpServers' },
        { id: 'claude-desktop-mac', app: 'Claude Desktop', path: join(mac, 'Claude', 'claude_desktop_config.json'), key: 'mcpServers' },
        { id: 'claude-desktop-linux', app: 'Claude Desktop', path: join(configHome, 'Claude', 'claude_desktop_config.json'), key: 'mcpServers' },
        { id: 'claude-code', app: 'Claude Code', path: join(home, '.claude.json'), key: 'mcpServers', projects: true },
        { id: 'cursor', app: 'Cursor', path: join(home, '.cursor', 'mcp.json'), key: 'mcpServers' },
        { id: 'cursor-project', app: 'Cursor（当前目录）', path: join(cwd, '.cursor', 'mcp.json'), key: 'mcpServers' },
        { id: 'vscode', app: 'VS Code', path: join(appData, 'Code', 'User', 'mcp.json'), key: 'servers' },
        { id: 'vscode-project', app: 'VS Code（当前目录）', path: join(cwd, '.vscode', 'mcp.json'), key: 'servers' },
        { id: 'windsurf', app: 'Windsurf', path: join(home, '.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers' },
        { id: 'cline', app: 'Cline', path: join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), key: 'mcpServers' },
        { id: 'roo', app: 'Roo Code', path: join(appData, 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'), key: 'mcpServers' },
        { id: 'continue', app: 'Continue', path: join(home, '.continue', 'config.json'), key: 'mcpServers' },
        { id: 'gemini', app: 'Gemini CLI', path: join(home, '.gemini', 'settings.json'), key: 'mcpServers' },
        { id: 'opencode', app: 'opencode', path: join(configHome, 'opencode', 'opencode.json'), key: 'mcp' },
        { id: 'opencode-windows', app: 'opencode', path: join(appData, 'opencode', 'opencode.json'), key: 'mcp' },
        { id: 'codex', app: 'Codex', path: join(home, '.codex', 'config.toml'), format: 'toml' },
        { id: 'zed', app: 'Zed', path: join(configHome, 'zed', 'settings.json'), key: 'context_servers' },
        { id: 'lmstudio', app: 'LM Studio', path: join(home, '.lmstudio', 'mcp.json'), key: 'mcpServers' },
        { id: 'project', app: '当前目录', path: join(cwd, '.mcp.json'), key: 'mcpServers' },
    ]
}

// --- 读一个配置文件；不存在返回 null，坏了返回 error ---
const readConfig = async (path, format) => {
    try {
        const file = Bun.file(path)
        if (!(await file.exists())) return null
        if (file.size > FILE_LIMIT) return { error: 'file is too large to read' }
        if (format === 'toml') return { data: parseToml(await file.text()) }
        return { data: await file.json() }
    } catch (error) {
        return { error: error.message }
    }
}

// --- 从一个配置对象里找出所有 MCP 服务表；整机扫描时文件可能长在任何位置 ---
const blocksOf = (data, path, format) => {
    if (!isObject(data)) return []
    if (format === 'toml') return [data]
    const blocks = []
    for (const key of ['mcpServers', 'mcp_servers', 'context_servers']) {
        if (isObject(data[key])) blocks.push(data[key])
    }
    // opencode 用 mcp；VS Code 用 servers，但只认文件名里带 mcp 的文件。
    if (isObject(data.mcp)) blocks.push(data.mcp)
    if (/mcp/i.test(basename(path)) && isObject(data.servers)) blocks.push(data.servers)
    if (isObject(data.projects)) {
        for (const project of Object.values(data.projects)) {
            if (isObject(project?.mcpServers)) blocks.push(project.mcpServers)
        }
    }
    return blocks
}

const formatOf = path => path.toLowerCase().endsWith('.toml') ? 'toml' : 'json'

// --- 整机扫描：把 rg 找到的配置文件读一遍，返回服务条目和覆盖统计 ---
const scanMcpFiles = async scanRoots => {
    const [byContent, byName] = await Promise.all([
        Machine.configFiles({ roots: scanRoots }),
        Machine.mcpNamedFiles({ roots: scanRoots }),
    ])
    const files = [...new Set([...byContent.files, ...byName.files])]
    const found = []
    let truncated = byContent.truncated || byName.truncated
    let failed = 0

    for (const path of files) {
        if (found.length >= FULL_SERVER_LIMIT) {
            truncated = true
            break
        }
        const format = formatOf(path)
        const result = await readConfig(path, format)
        if (!result || result.error) {
            if (result?.error) failed += 1
            continue
        }
        for (const block of blocksOf(result.data, path, format)) {
            for (const [name, raw] of Object.entries(block)) {
                if (typeof name !== 'string' || !name.trim()) continue
                const value = normalizeServer(raw)
                if (!value) continue
                found.push({ id: `scan::${resolve(path)}::${name}`, name, app: '本机扫描', source: 'scan', path: resolve(path), definition: value })
                if (found.length >= FULL_SERVER_LIMIT) break
            }
            if (found.length >= FULL_SERVER_LIMIT) break
        }
    }

    return {
        files,
        servers: found,
        scan: {
            full: true,
            files: files.length,
            failed,
            durationMs: Math.max(byContent.durationMs || 0, byName.durationMs || 0),
            truncated,
        },
    }
}

// --- 扫描本机全部已知位置；full 时再补一遍整机扫描 ---
const mcp = async ({ cwd = process.cwd(), home = Path.userHome(), env = process.env, redact = true, full = false, scanRoots = null } = {}) => {
    const key = `${cwd}:${home}:${scanRoots ? JSON.stringify(scanRoots) : ''}`
    const fullResult = full ? (cached('mcp', key) || remember('mcp', key, await scanMcpFiles(scanRoots))) : null
    const sources = []
    const servers = []
    const seen = new Set()
    const configured = store.config.mcp || {}

    for (const source of candidates({ cwd, home, env })) {
        const result = await readConfig(source.path, source.format)
        if (!result) continue
        if (result.error) {
            sources.push({ id: source.id, app: source.app, path: resolve(source.path), error: result.error })
            continue
        }

        // 一个文件里可能同时有全局服务和当前目录的项目服务。
        const blocks = []
        if (source.format === 'toml') {
            blocks.push({ block: result.data, label: source.app })
        } else {
            if (isObject(result.data?.[source.key])) blocks.push({ block: result.data[source.key], label: source.app })
            if (source.projects && isObject(result.data?.projects)) {
                for (const [projectPath, project] of Object.entries(result.data.projects)) {
                    if (!Skills.samePath(projectPath, cwd)) continue
                    if (isObject(project?.mcpServers)) blocks.push({ block: project.mcpServers, label: `${source.app}（当前目录）` })
                }
            }
        }

        let count = 0
        for (const { block, label } of blocks) {
            for (const [name, raw] of Object.entries(block)) {
                if (servers.length >= SERVER_LIMIT) break
                if (typeof name !== 'string' || !name.trim()) continue
                const value = normalizeServer(raw)
                if (!value) continue
                count += 1
                const id = `${source.id}::${name}`
                if (seen.has(id)) continue
                seen.add(`${resolve(source.path)}::${name}`)
                seen.add(id)
                const masked = redact ? mask(value) : { definition: value, envKeys: [], headerKeys: [] }
                servers.push({
                    id,
                    name,
                    app: label,
                    source: source.id,
                    path: resolve(source.path),
                    definition: masked.definition,
                    envKeys: masked.envKeys,
                    headerKeys: masked.headerKeys,
                    configured: Boolean(configured[name]),
                })
            }
        }
        sources.push({ id: source.id, app: source.app, path: resolve(source.path), servers: count })
    }

    if (fullResult) {
        let added = 0
        for (const server of fullResult.servers) {
            if (servers.length >= FULL_SERVER_LIMIT) break
            const keyOfServer = `${server.path}::${server.name}`
            if (seen.has(keyOfServer)) continue
            seen.add(keyOfServer)
            const masked = redact ? mask(server.definition) : { definition: server.definition, envKeys: [], headerKeys: [] }
            servers.push({
                ...server,
                definition: masked.definition,
                envKeys: masked.envKeys,
                headerKeys: masked.headerKeys,
                configured: Boolean(configured[server.name]),
            })
            added += 1
        }
        sources.push({ id: 'scan', app: '本机扫描', path: '多个位置', servers: added })
    }

    servers.sort((first, second) => first.name.localeCompare(second.name) || first.app.localeCompare(second.app))
    return { sources, servers, scan: fullResult?.scan || null }
}

// --- 整机技能目录：把每个 SKILL.md 归到它所属的 skills 目录；不是 skills 布局的按单技能目录算 ---
const scanSkillRoots = async scanRoots => {
    const result = await Machine.skillFiles({ roots: scanRoots })
    const groups = new Map()
    for (const file of result.files) {
        const directory = dirname(file)
        const parent = dirname(directory)
        const parentName = basename(parent).toLowerCase()
        const root = parentName === 'skills' || parentName === 'skill' ? parent : directory
        const key = process.platform === 'win32' ? root.toLowerCase() : root
        if (!groups.has(key)) groups.set(key, { root, count: 0 })
        groups.get(key).count += 1
    }

    const groupsList = [...groups.values()].sort((first, second) => second.count - first.count || first.root.localeCompare(second.root))
    const roots = []
    let truncated = result.truncated || groupsList.length > ROOT_LIMIT

    // 只按文件数出目录，不再逐个目录重读 SKILL.md；启用某个目录时才真正读取正文。
    for (const group of groupsList.slice(0, ROOT_LIMIT)) {
        roots.push({
            id: `found-${roots.length + 1}`,
            label: basename(group.root) || group.root,
            app: '本机扫描',
            path: resolve(group.root),
            scope: 'global',
            kind: 'found',
            editable: false,
            enabled: false,
            exists: true,
            skillCount: group.count,
            skills: [],
        })
    }

    return {
        roots,
        scan: {
            full: true,
            files: result.files.length,
            roots: groups.size,
            durationMs: result.durationMs,
            truncated,
        },
    }
}

const skills = async ({ cwd = process.cwd(), full = false, scanRoots = null } = {}) => {
    if (!full) return { roots: [], scan: null }
    const key = `${cwd}:${scanRoots ? JSON.stringify(scanRoots) : ''}`
    const value = cached('skills', key) || remember('skills', key, await scanSkillRoots(scanRoots))
    return value
}

export default { mcp, skills }
