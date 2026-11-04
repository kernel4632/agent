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

import { join, resolve } from 'node:path'
import Path from '../utils/path.js'
import Skills from '../utils/skills.js'

const FILE_LIMIT = 16 * 1024 * 1024   // 有些客户端把整个项目表写进一个文件，给足余量
const SERVER_LIMIT = 200

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

// --- 扫描本机全部已知位置 ---
// configuredNames：本应用已经配置的服务名，由命令层从 features/mcp.js 取来传入；
// utils 之上的这一层不 import store，也不 import 兄弟 feature。
const mcp = async ({ cwd = process.cwd(), home = Path.userHome(), env = process.env, redact = true, configuredNames = [] } = {}) => {
    const sources = []
    const servers = []
    const seen = new Set()
    const configured = new Set(configuredNames)

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
                    configured: configured.has(name),
                })
            }
        }
        sources.push({ id: source.id, app: source.app, path: resolve(source.path), servers: count })
    }

    servers.sort((first, second) => first.name.localeCompare(second.name) || first.app.localeCompare(second.app))
    return { sources, servers }
}

export default { mcp }
