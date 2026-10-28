/*
 * 文件与目录工具：读、写、列目录、编辑、多文件补丁，以及文件自己的快照和恢复。
 *
 * 这一组工具只碰文件，不碰会话运行状态。会改文件的工具都带一个 snapshot 钩子：
 * 真正写入之前由审批关口调用，把原样存进会话的快照目录；回退时从这里恢复。
 * 敏感文件判断也在这里：.env、私钥、.ssh 目录等永远不交给模型，配置关不掉。
 *
 * 调用示例：
 *   import File from '../tools/file.js'
 *   await File.read_file.execute({ path: './a.txt' }, { cwd: 'D:/notes' })
 *   await File.snapshot({ sessionId, messageId, toolCallId, toolName: 'write_to_file', input, cwd })
 *   await File.restoreTool({ sessionId, toolCallId })
 *   const changes = await File.diff({ sessionId })
 */

import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { writeFile as atomicWrite } from 'atomically'
import picomatch from 'picomatch'
import { rgPath } from '@vscode/ripgrep'
import store from '../store.js'
import Path from '../utils/path.js'
import fail from '../utils/fail.js'
import { truncate } from '../utils/text.js'

// --- 搜索和列目录时永远跳过的目录 ---
const SKIP = [
    'node_modules', '.git', 'vendor', '.venv', 'venv', '__pycache__',
    '.cache', '.turbo', '.parcel-cache', '.gradle', '.idea', '.vscode',
    'dist', 'build', 'out', 'target', '.next', '.nuxt', '.output',
    '.svelte-kit', 'coverage',
]
const skipPath = path => String(path).replace(/\\/g, '/').split('/').some(part => SKIP.includes(part))

// --- 敏感文件：里面有密钥或机器凭据，不交给模型 ---
const SENSITIVE = [
    '.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx',
    'id_rsa*', 'id_ed25519*', '.npmrc', '.netrc', '.git-credentials',
    '**/.ssh/**', '**/.aws/**', '**/.gnupg/**', '**/.agent/**',
]
const sensitiveRules = SENSITIVE.map(rule => picomatch(rule, { dot: true }))

// --- 判断一个路径是不是不该碰 ---
const sensitive = path => {
    const text = String(path).replace(/\\/g, '/')
    return sensitiveRules.some(matches => matches(text) || matches(basename(text)))
}

// --- 不碰敏感文件；碰到就报错，让模型知道换一条路 ---
const guard = paths => {
    for (const path of paths) {
        if (sensitive(path)) throw new Error(`Refusing to touch a protected file: ${path}`)
    }
}

// --- 相对路径按会话当前目录算 ---
const absolute = (path, cwd) => isAbsolute(path) ? path : resolve(cwd || process.cwd(), path)

// --- 一次工具调用会碰哪些文件 ---
const filePaths = ({ toolName, input, cwd }) => {
    if (toolName === 'write_to_file') return [input.path]
    if (toolName === 'edit') return [input.file_path ?? input.path]
    if (toolName === 'apply_patch') return (input.patches || []).map(item => item.path).filter(Boolean)
    return []
}

// =======================================================================
//  文件快照
// =======================================================================

const DEFAULT_MAX_FILES = 2000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

// 快照清单跟着会话走；value 是 { checkpoints: [], redone: [] }。
const manifests = new Map()
// 正在等结果的 shell 调用：key 是 `${sessionId}:${toolCallId}`。
const shells = new Map()
// 文件指纹缓存：文件没变时不用重新读一遍。
const fingerprints = new Map()

const backupPath = (sessionId, hash) => join(Path.snapshots(sessionId), hash)

// --- 按内容算指纹；同一份内容只备份一次 ---
const fingerprint = async path => {
    const content = await Bun.file(path).arrayBuffer()
    return createHash('sha256').update(Buffer.from(content)).digest('hex')
}

// --- 保存一个文件现在的样子 ---
const backup = async ({ sessionId, path }) => {
    if (!await Bun.file(path).exists()) return null
    const hash = await fingerprint(path)
    return backupKnown({ sessionId, path, hash })
}

// --- 用已经算好的指纹备份，避免重复计算 ---
const backupKnown = async ({ sessionId, path, hash }) => {
    const target = backupPath(sessionId, hash)
    if (!await Bun.file(target).exists()) {
        await mkdir(Path.snapshots(sessionId), { recursive: true })
        await cp(path, target)
    }
    return hash
}

// --- 读取快照清单，第一次读时从磁盘装进来 ---
const loadManifest = async sessionId => {
    if (manifests.has(sessionId)) return manifests.get(sessionId)
    const file = Bun.file(Path.checkpoints(sessionId))
    const manifest = await file.exists() ? await file.json() : { checkpoints: [], redone: [] }
    manifest.redone ||= []
    manifests.set(sessionId, manifest)
    return manifest
}

// --- 保存快照清单 ---
const saveManifest = async ({ sessionId, manifest }) => {
    await mkdir(Path.snapshots(sessionId), { recursive: true })
    await Bun.write(Path.checkpoints(sessionId), JSON.stringify(manifest, null, 2))
}

// --- 工具真正执行之前：把要改的文件原样存一份 ---
const snapshot = async ({ sessionId, messageId, toolCallId, toolName, input, cwd }) => {
    if (!sessionId) return []
    const paths = filePaths({ toolName, input, cwd })
    if (!paths.length) return []

    const manifest = await loadManifest(sessionId)
    const id = toolCallId || messageId || `${toolName}-${Date.now()}`
    let entry = manifest.checkpoints.findLast(item => item.id === id)
    if (!entry) {
        entry = { id, messageId, toolCallId, toolName, files: {} }
        manifest.checkpoints.push(entry)
    }

    const recorded = []
    for (const path of paths) {
        const target = absolute(path, cwd)
        if (target in entry.files) continue // 这次调用已经存过，要留的是它开始前的样子。
        fingerprints.delete(target)
        entry.files[target] = await backup({ sessionId, path: target })
        recorded.push(target)
    }
    await saveManifest({ sessionId, manifest })
    return recorded
}

// --- 扫一遍目录，记下每个文件的指纹；需要时顺手备份 ---
const capture = async ({ sessionId, cwd, backupFiles = false, maxFiles = DEFAULT_MAX_FILES, maxBytes = DEFAULT_MAX_BYTES }) => {
    const root = cwd || process.cwd()
    const manifest = new Map()
    for await (const entry of new Bun.Glob('**/*').scan({ cwd: root, onlyFiles: true, dot: true })) {
        const relativePath = entry.replace(/\\/g, '/')
        if (skipPath(relativePath)) continue

        const target = resolve(root, entry)
        const info = await stat(target).catch(() => null)
        if (!info || !info.isFile() || info.size > maxBytes) continue
        if (manifest.size >= maxFiles) return { skipped: true, reason: `文件数超过 ${maxFiles}` }

        let hash
        const cached = fingerprints.get(target)
        if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs && cached.ctimeMs === info.ctimeMs) {
            hash = cached.hash
        } else {
            try {
                hash = await fingerprint(target)
            } catch {
                continue // 读不了的文件（权限、被占用）跳过，不因为一个文件放弃整次快照。
            }
            fingerprints.set(target, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, hash })
        }
        if (backupFiles) await backupKnown({ sessionId, path: target, hash })
        manifest.set(target, hash)
    }
    return { skipped: false, manifest }
}

// --- 命令 execution 前：先把整个目录的状态记下来 ---
const shellStart = async ({ sessionId, messageId, toolCallId, input, cwd } = {}) => {
    if (store.config.snapshot?.shell !== true) return { skipped: true, reason: 'disabled' }
    if (!sessionId || !toolCallId) return { skipped: true, reason: 'no call id' }

    // 命令自己的 cwd 可能指向子目录；快照要扫它真正会改的那一块。
    const base = cwd || process.cwd()
    const root = typeof input?.cwd === 'string' && input.cwd.trim()
        ? (isAbsolute(input.cwd) ? input.cwd : resolve(base, input.cwd))
        : base

    const result = await capture({
        sessionId,
        cwd: root,
        backupFiles: true,
        maxFiles: Number(store.config.snapshot?.maxFiles) || DEFAULT_MAX_FILES,
        maxBytes: Number(store.config.snapshot?.maxBytes) || DEFAULT_MAX_BYTES,
    })
    if (result.skipped) return result

    const key = `${sessionId}:${toolCallId}`
    // 命令没有结果（进程被杀、任务被停）时，十五分钟后把这份清单丢掉。
    const timer = setTimeout(() => shells.delete(key), 15 * 60 * 1000)
    timer.unref?.()
    shells.set(key, { manifest: result.manifest, messageId, toolCallId, root, timer })
    return { skipped: false, files: result.manifest.size }
}

// --- 命令结束后：只把真正变过的文件记成一次检查点 ---
const shellEnd = async ({ sessionId, toolCallId } = {}) => {
    const key = `${sessionId}:${toolCallId}`
    const state = shells.get(key)
    if (!state) return { skipped: true, reason: 'no snapshot' }
    shells.delete(key)
    clearTimeout(state.timer)

    const result = await capture({
        sessionId,
        cwd: state.root,
        maxFiles: Number(store.config.snapshot?.maxFiles) || DEFAULT_MAX_FILES,
        maxBytes: Number(store.config.snapshot?.maxBytes) || DEFAULT_MAX_BYTES,
    })
    if (result.skipped) return result

    const files = {}
    for (const [path, hash] of result.manifest) {
        const before = state.manifest.get(path)
        if (before === undefined) files[path] = null
        else if (before !== hash) files[path] = before
    }
    for (const [path, hash] of state.manifest) {
        if (!result.manifest.has(path)) files[path] = hash
    }
    if (!Object.keys(files).length) return { skipped: false, changed: 0 }

    const manifest = await loadManifest(sessionId)
    if (!manifest.checkpoints.some(entry => entry.id === toolCallId)) {
        manifest.checkpoints.push({ id: toolCallId, messageId: state.messageId, toolCallId, toolName: 'execute_command', files })
        await saveManifest({ sessionId, manifest })
    }
    return { skipped: false, changed: Object.keys(files).length }
}

// --- 记过哪些工具调用 ---
const entries = async ({ sessionId }) => {
    const manifest = await loadManifest(sessionId)
    return manifest.checkpoints.map(entry => ({
        id: entry.id,
        messageId: entry.messageId,
        toolCallId: entry.toolCallId,
        toolName: entry.toolName,
        paths: Object.keys(entry.files),
    }))
}

// --- 丢掉这个会话还在等结果的 shell 快照 ---
const clearShells = sessionId => {
    for (const [key, state] of shells) {
        if (!key.startsWith(`${sessionId}:`)) continue
        clearTimeout(state.timer)
        shells.delete(key)
    }
}

// --- 按"路径 → 指纹"把文件铺回磁盘；null 表示那时文件还不存在 ---
const writeFiles = async ({ sessionId, wanted }) => {
    const restored = []
    for (const [path, hash] of wanted) {
        if (hash === null) {
            await rm(path, { force: true })
        } else {
            await mkdir(dirname(path), { recursive: true })
            await cp(backupPath(sessionId, hash), path)
        }
        restored.push(path)
        fingerprints.delete(resolve(path))
    }
    return restored
}

// --- 恢复到 keepIds 之前的样子，并把被删掉的记录压进撤销栈 ---
const restore = async ({ sessionId, keepIds }) => {
    clearShells(sessionId)
    const manifest = await loadManifest(sessionId)
    const dropped = manifest.checkpoints.filter(entry => !keepIds.includes(entry.id))
    if (!dropped.length) return []
    const kept = manifest.checkpoints.filter(entry => keepIds.includes(entry.id))

    // 每个文件取"最早被回退掉的那次记录"里的原样，那才是回退点的状态。
    const wanted = new Map()
    for (const entry of dropped) {
        for (const [path, hash] of Object.entries(entry.files)) {
            if (!wanted.has(path)) wanted.set(path, hash)
        }
    }

    // 恢复之前先把"现在是什么样"存下来，撤销回退时才能还原。
    const after = {}
    for (const path of wanted.keys()) after[path] = await backup({ sessionId, path })

    const restored = await writeFiles({ sessionId, wanted })
    manifest.checkpoints = kept
    manifest.redone.push({ entries: dropped, after })
    await saveManifest({ sessionId, manifest })
    return restored
}

// --- 退回某一次工具调用之前 ---
const restoreTool = async ({ sessionId, toolCallId }) => {
    const manifest = await loadManifest(sessionId)
    const index = manifest.checkpoints.findIndex(entry => entry.id === toolCallId || entry.toolCallId === toolCallId)
    if (index < 0) throw fail(404, `Tool call not found in snapshots: ${toolCallId}`)
    return restore({ sessionId, keepIds: manifest.checkpoints.slice(0, index).map(entry => entry.id) })
}

// --- 退回某条消息之前 ---
const restoreMessage = async ({ sessionId, keepMessages }) => {
    const manifest = await loadManifest(sessionId)
    const keepIds = manifest.checkpoints.filter(entry => keepMessages.includes(entry.messageId)).map(entry => entry.id)
    return restore({ sessionId, keepIds })
}

// --- 只去掉记录，不动磁盘上的文件 ---
const dropTool = async ({ sessionId, toolCallId }) => {
    const manifest = await loadManifest(sessionId)
    const index = manifest.checkpoints.findIndex(entry => entry.id === toolCallId || entry.toolCallId === toolCallId)
    if (index < 0) throw fail(404, `Tool call not found in snapshots: ${toolCallId}`)

    const dropped = manifest.checkpoints.splice(index)
    manifest.redone.push({ entries: dropped, after: {} })
    await saveManifest({ sessionId, manifest })
    return []
}

// --- 撤销最近一次回退 ---
const undo = async ({ sessionId }) => {
    clearShells(sessionId)
    const manifest = await loadManifest(sessionId)
    const last = manifest.redone.pop()
    if (!last) return []
    const restored = await writeFiles({ sessionId, wanted: new Map(Object.entries(last.after)) })
    manifest.checkpoints.push(...last.entries)
    await saveManifest({ sessionId, manifest })
    return restored
}

// --- 发新消息后，之前的回退不能再撤销 ---
const clearUndo = async ({ sessionId }) => {
    const manifest = await loadManifest(sessionId)
    if (!manifest.redone.length) return
    manifest.redone = []
    await saveManifest({ sessionId, manifest })
}

// --- 这些文件现在和记录时有什么不同 ---
const diff = async ({ sessionId }) => {
    const manifest = await loadManifest(sessionId)
    const changed = new Map()

    // 每个文件只要最早那份记录：那是这一串改动开始前的样子。
    for (const entry of manifest.checkpoints) {
        for (const [path, hash] of Object.entries(entry.files)) {
            if (!changed.has(path)) changed.set(path, hash)
        }
    }

    const files = []
    for (const [path, original] of changed) {
        const exists = await Bun.file(path).exists()
        const current = exists ? await fingerprint(path) : null
        if (current === original) continue

        const before = original === null ? '' : await Bun.file(backupPath(sessionId, original)).text()
        const after = exists ? await Bun.file(path).text() : ''
        files.push({ path, before, after, added: original === null, deleted: current === null })
    }
    return files
}

// --- 会话删除时清掉快照和清单 ---
const remove = async ({ sessionId }) => {
    clearShells(sessionId)
    manifests.delete(sessionId)
    await rm(Path.snapshots(sessionId), { recursive: true, force: true })
    await rm(Path.checkpoints(sessionId), { force: true })
}

// =======================================================================
//  工具定义
// =======================================================================

// --- 读取文本或图片 ---
const readFile = {
    name: 'read_file',
    kind: 'read',
    files: input => [input.path],
    ui: {
        view: 'file-read',
        icon: 'document',
        title: '读取文件',
        summary: '{path}',
        actions: [{ id: 'copy-path', label: '复制路径', icon: 'copy', type: 'copy', value: 'path' }],
    },
    description: [
        'Read the contents of a file at the given path. Returns the raw text, or the image itself when the file is an image.',
        'Paths are relative to the session current directory unless absolute.',
        'Parameters: - path (required): file to read.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
    },
    async execute({ path }, options = {}) {
        const target = absolute(path, options.cwd)
        guard([target])
        const file = Bun.file(target)
        if (!await file.exists()) throw new Error(`File not found: ${target}`)

        const mediaType = file.type || 'application/octet-stream'
        if (mediaType.startsWith('image/')) {
            const data = Buffer.from(await file.arrayBuffer()).toString('base64')
            return { output: { path: target, mediaType, data } }
        }
        return await file.text()
    },
    toModelOutput({ output }) {
        if (typeof output === 'string') return { type: 'text', value: output }
        return { type: 'content', value: [
            { type: 'text', text: `Image read from ${output.path}` },
            { type: 'file', mediaType: output.mediaType, data: { type: 'data', data: output.data } },
        ] }
    },
}

// --- 写入完整文本文件 ---
const writeToFile = {
    name: 'write_to_file',
    kind: 'write',
    files: input => [input.path],
    snapshot,
    ui: {
        view: 'file-write',
        icon: 'edit',
        title: '写入文件',
        summary: '{path}',
        actions: [{ id: 'copy-path', label: '复制路径', icon: 'copy', type: 'copy', value: 'path' }],
    },
    description: [
        'Write the complete new content of a file, replacing whatever was there before. Parent directories are created automatically.',
        'You must supply the FULL content — partial content will overwrite and destroy the rest of the file. Use edit to change only part of a file.',
        'Paths are relative to the session current directory unless absolute.',
        'Parameters: - path (required): file to write. - content (required): the complete new content.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
    },
    async execute({ path, content }, options = {}) {
        const target = absolute(path, options.cwd)
        guard([target])
        await mkdir(dirname(target), { recursive: true })
        await atomicWrite(target, content)
        return `Wrote ${Buffer.byteLength(content)} bytes to ${target}`
    },
}

// --- 列出目录 ---
const listFiles = {
    name: 'list_files',
    kind: 'read',
    files: input => [input.path],
    ui: {
        view: 'file-list',
        icon: 'folder',
        title: '列出目录',
        summary: '{path}',
        actions: [{ id: 'copy-path', label: '复制路径', icon: 'copy', type: 'copy', value: 'path' }],
    },
    description: [
        'List files and subdirectories inside a directory. Subdirectory names end with /.',
        'Set recursive to true to walk nested directories; dependency and build folders are skipped.',
        'Parameters: - path (required): directory to list. - recursive (optional): true to include nested entries.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, recursive: { type: 'boolean' } },
        required: ['path'],
    },
    async execute({ path, recursive = false }, options = {}) {
        const root = absolute(path, options.cwd)
        guard([root])
        if (!recursive) {
            const entries = await readdir(root, { withFileTypes: true })
            return entries.map(entry => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
        }

        const entries = []
        const walk = async directory => {
            const children = await readdir(directory, { withFileTypes: true })
            for (const entry of children) {
                const target = join(directory, entry.name)
                const relativePath = relative(root, target).replace(/\\/g, '/')
                if (skipPath(relativePath)) continue
                entries.push(`${relativePath}${entry.isDirectory() ? '/' : ''}`)
                if (entry.isDirectory()) await walk(target)
            }
        }
        await walk(root)
        return entries
    },
}

// --- 按通配模式找文件 ---
const glob = {
    name: 'glob',
    kind: 'read',
    files: input => [input.path],
    ui: {
        view: 'file-list',
        icon: 'folder',
        title: '查找文件',
        summary: '{pattern}',
        actions: [{ id: 'copy-pattern', label: '复制模式', icon: 'copy', type: 'copy', value: 'pattern' }],
    },
    description: [
        'Find files whose names match a glob pattern (e.g. **/*.test.js, src/*.ts), searching under a directory.',
        'Returns matching paths, not contents. Follow up with read_file on the files you care about.',
        'Parameters: - path (required): directory to search in. - pattern (required): glob pattern for file names.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, pattern: { type: 'string' } },
        required: ['path', 'pattern'],
    },
    async execute({ path, pattern }, options = {}) {
        const root = absolute(path, options.cwd)
        guard([root])
        const files = []
        for await (const file of new Bun.Glob(pattern).scan({ cwd: root, dot: true })) {
            if (skipPath(file)) continue
            files.push(file)
            if (files.length >= 1000) break
        }
        return files
    },
}

// --- 搜索文件内容 ---
const searchFiles = {
    name: 'search_files',
    kind: 'read',
    files: input => [input.path],
    ui: {
        view: 'search',
        icon: 'search',
        title: '搜索文件',
        summary: '{regex}',
        actions: [{ id: 'copy-regex', label: '复制正则', icon: 'copy', type: 'copy', value: 'regex' }],
    },
    description: [
        'Search file contents for a regular expression and return the matching lines with file and line number.',
        'Parameters: - path (required): file or directory to search in. - regex (required): regular expression.',
        '- file_pattern (optional): glob filter, e.g. *.js. - context (optional): lines before and after, 0-20.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            regex: { type: 'string' },
            file_pattern: { type: 'string' },
            context: { type: 'integer', minimum: 0, maximum: 20 },
        },
        required: ['path', 'regex'],
    },
    async execute({ path, regex, file_pattern, pattern, include, context }, options = {}) {
        const needle = regex ?? pattern
        const filter = file_pattern ?? include
        if (!needle) throw new Error('regex is required')

        const target = absolute(path, options.cwd)
        guard([target])
        const info = await stat(target).catch(() => null)
        const cwd = info?.isFile() ? dirname(target) : target
        const search = info?.isFile() ? basename(target) : '.'

        const command = [rgPath, '--line-number', '--color', 'never']
        for (const name of SKIP.filter(item => item !== '.vscode')) command.push('--glob', `!**/${name}/**`)
        if (filter) command.push('--glob', filter)
        const around = Math.min(20, Math.max(0, Math.floor(Number(context) || 0)))
        if (around) command.push('--context', String(around))
        command.push(needle, search)

        const process = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
        options.abortSignal?.addEventListener('abort', () => process.kill(), { once: true })
        const [output, error, exitCode] = await Promise.all([
            process.stdout.text(),
            process.stderr.text(),
            process.exited,
        ])
        if (exitCode > 1) throw new Error(error.trim() || `ripgrep exited with code ${exitCode}`)
        return truncate(output.trimEnd())
    },
}

// --- 替换文件里的一段文本 ---
const edit = {
    name: 'edit',
    kind: 'write',
    files: input => [input.file_path],
    snapshot,
    ui: {
        view: 'edit',
        icon: 'edit',
        title: '编辑文件',
        summary: '{file_path}',
        actions: [{ id: 'copy-path', label: '复制路径', icon: 'copy', type: 'copy', value: 'file_path' }],
    },
    description: [
        'Replace a specific text block in a file with new text. By default the old block must appear exactly once.',
        'Read the file first so old_string matches byte-for-byte, including whitespace.',
        'Parameters: - file_path (required): file to edit. - old_string (required): exact existing text.',
        '- new_string (required): replacement. - replace_all (optional): replace every occurrence.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            file_path: { type: 'string' },
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            replace_all: { type: 'boolean' },
        },
        required: ['file_path', 'old_string', 'new_string'],
    },
    async execute({ file_path, old_string, new_string, replace_all }, options = {}) {
        const target = absolute(file_path, options.cwd)
        guard([target])
        const content = await Bun.file(target).text()
        const matches = content.split(old_string).length - 1
        if (!matches) throw new Error(`old_string was not found in ${target}`)
        if (!replace_all && matches !== 1) throw new Error(`old_string must occur exactly once, found ${matches}`)

        const next = replace_all ? content.split(old_string).join(new_string) : content.replace(old_string, new_string)
        await atomicWrite(target, next)
        return `Edited ${target}`
    },
}

// --- 一次改多个文件，全部校验通过才写盘 ---
const patch = {
    name: 'apply_patch',
    kind: 'write',
    files: input => (input.patches || []).map(item => item.path).filter(Boolean),
    snapshot,
    ui: {
        view: 'patch',
        icon: 'edit',
        title: '批量修改',
        summary: '批量修改文件',
    },
    description: [
        'Apply several exact-match text replacements across multiple files in one atomic step: either every edit succeeds, or nothing is written.',
        'Each oldText must appear exactly once within its file. Read the files first.',
        'Parameters: - patches (required): list of { path, oldText, newText }.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            patches: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
                    required: ['path', 'oldText', 'newText'],
                },
            },
        },
        required: ['patches'],
    },
    async execute({ patches }, options = {}) {
        const prepared = []

        // 第一轮只读不改：任何一处对不上，后面一个字节都不会写。
        for (const { path, oldText, newText } of patches) {
            const target = absolute(path, options.cwd)
            guard([target])
            const file = Bun.file(target)
            if (!await file.exists()) throw new Error(`Cannot patch ${target}: file not found`)

            const content = await file.text()
            const matches = content.split(oldText).length - 1
            if (matches !== 1) throw new Error(`Cannot patch ${target}: oldText must occur exactly once, found ${matches}`)
            prepared.push({ path: target, content: content.replace(oldText, newText) })
        }

        // 第二轮才写盘，此时每个文件都已经确认可以改。
        for (const { path, content } of prepared) {
            await mkdir(dirname(path), { recursive: true })
            await atomicWrite(path, content)
        }
        return `Patched ${prepared.length} file(s): ${prepared.map(item => item.path).join(', ')}`
    },
}

export {
    readFile as read_file,
    writeToFile as write_to_file,
    listFiles as list_files,
    glob,
    searchFiles as search_files,
    edit,
    patch as apply_patch,
    skipPath, sensitive, snapshot, shellStart, shellEnd, entries,
    restoreTool, restoreMessage, dropTool, undo, clearUndo, diff, remove,
}

export default [readFile, writeToFile, listFiles, glob, searchFiles, edit, patch]
