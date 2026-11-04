/*
 * 整机扫描：用随包发布的 ripgrep 找出所有 SKILL.md 和可能含 MCP 配置的文件。
 *
 * 只读，不执行任何配置里的命令。系统目录、依赖目录和缓存目录不扫，
 * 因为它只可能拖慢速度；用户目录和所有固定磁盘按深度限制扫描，结果带覆盖统计。
 * 路径和超时都在这里收口，上层不需要知道 rg 参数。
 *
 * 调用示例：
 *   const { files, truncated, durationMs } = await Machine.skillFiles()
 *   const { files, truncated, durationMs } = await Machine.configFiles()
 */

import { rgPath } from '@vscode/ripgrep'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_FILES = 20000
const TIMEOUT_MS = 45000

// 目录名匹配不区分大小写；这些位置不可能放用户技能或 MCP 配置。
const EXCLUDES = [
    'node_modules', '.git', '.svn', '.hg', 'Windows', 'Program Files', 'Program Files (x86)',
    'ProgramData', '$RECYCLE.BIN', 'System Volume Information', 'WindowsApps', 'WpSystem',
    'DeliveryOptimization', 'WUDownloadCache', 'AppData/Local/Packages', 'AppData/Local/Temp',
    'AppData/Local/Microsoft', '.cache', 'Cache', 'Code Cache', 'GPUCache', 'dist', 'build',
    '.venv', 'venv', 'site-packages', 'target', '.pnpm-store', 'npm_cache', 'pip_cache',
    'nodejs', 'Python311', 'Python314', 'mingw64', 'gopath', 'go-build', 'gradle_user_home',
    'DevCache', 'ms-playwright', 'Steam', 'SteamApps', 'WeGameApps', 'VMware',
    'BaiduNetdiskDownload', 'Downloads_清理暂存', '5EDemocache',
]

const globArgs = () => EXCLUDES.flatMap(name => ['-g', `!**/${name}/**`])

// --- 扫描根：所有用户目录按完整深度，其他固定磁盘按七层；系统目录由 EXCLUDES 排除 ---
let rootsCache = null
const roots = async () => {
    if (rootsCache) return rootsCache
    if (process.platform !== 'win32') {
        rootsCache = [{ path: '/', depth: 8 }]
        return rootsCache
    }

    const list = [{ path: join(process.env.SystemDrive || 'C:', 'Users'), depth: 12 }]
    for (let code = 67; code <= 90; code += 1) {
        const path = `${String.fromCharCode(code)}:\\`
        if (path.startsWith((process.env.SystemDrive || 'C:').slice(0, 1))) continue
        try {
            await readdir(path)
            list.push({ path, depth: 7 })
        } catch {
            // 光驱、网络盘和没插的盘符直接跳过。
        }
    }
    rootsCache = list
    return list
}

// --- 跑一次 ripgrep，超时就停；返回已经拿到的部分 ---
const run = async (args, timeoutMs = TIMEOUT_MS) => {
    const started = Date.now()
    let proc
    let timer
    try {
        proc = Bun.spawn([rgPath, ...args], { stdout: 'pipe', stderr: 'ignore' })
        timer = setTimeout(() => {
            try {
                proc.kill()
            } catch {
                // 进程已经结束时 kill 会抛错，忽略。
            }
        }, timeoutMs)
        const text = await new Response(proc.stdout).text()
        await proc.exited.catch(() => {})
        const lines = text.split(/\r?\n/).filter(Boolean)
        return {
            lines: lines.slice(0, MAX_FILES),
            truncated: Date.now() - started >= timeoutMs || lines.length > MAX_FILES,
            durationMs: Date.now() - started,
        }
    } catch (error) {
        return { lines: [], truncated: true, durationMs: Date.now() - started, error: error.message }
    } finally {
        clearTimeout(timer)
    }
}

const scan = async (buildArgs, { timeoutMs = TIMEOUT_MS, roots: override } = {}) => {
    const started = Date.now()
    const found = new Set()
    let truncated = false
    let error = ''
    for (const root of override || await roots()) {
        const result = await run([...buildArgs(root.depth), ...globArgs(), '--glob-case-insensitive', root.path], timeoutMs)
        for (const line of result.lines) found.add(line)
        if (result.truncated) truncated = true
        if (result.error) error = result.error
        if (found.size >= MAX_FILES) {
            truncated = true
            break
        }
    }
    return {
        files: [...found].slice(0, MAX_FILES),
        truncated,
        error,
        durationMs: Date.now() - started,
    }
}

// --- 所有技能文件 ---
const skillFiles = options => scan(depth => ['--files', '--hidden', '--no-ignore', '--no-messages', '--max-depth', String(depth), '-g', 'SKILL.md'], options)

// --- 可能包含 MCP 配置的文件：先按内容签名找，再补上文件名带 mcp 的配置 ---
const configFiles = options => scan(depth => [
    '--files-with-matches',
    '--hidden',
    '--no-ignore',
    '--no-messages',
    // 内容搜索比按文件名找慢得多；固定磁盘只下探到六层，用户目录仍按完整深度。
    '--max-depth', String(depth >= 12 ? depth : Math.min(depth, 6)),
    '--max-filesize', '2M',
    '-g', '*.json',
    '-g', '*.toml',
    '-e', 'mcpServers',
    '-e', 'mcp_servers',
    '-e', 'context_servers',
    '-e', '"mcp"\\s*:',
], options)

const mcpNamedFiles = options => scan(depth => [
    '--files',
    '--hidden',
    '--no-ignore',
    '--no-messages',
    '--max-depth', String(depth >= 12 ? depth : Math.min(depth, 6)),
    '-g', '*mcp*.json',
    '-g', '*mcp*.toml',
], options)

export default { roots, skillFiles, configFiles, mcpNamedFiles, EXCLUDES }
