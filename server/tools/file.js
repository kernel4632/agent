/*
 * 文件与目录工具：读、分段读、写、找文件、搜内容、编辑（一次调用改一个文件），以及文件自己的快照和恢复。
 *
 * 这一组工具只碰文件，不碰会话运行状态。会改文件的工具都带一个 snapshot 钩子：
 * 真正写入之前由审批关口调用，把原样存进会话的快照目录；回退时从这里恢复。
 * 敏感文件判断也在这里：.env、私钥、.ssh 目录等永远不交给模型，配置关不掉。
 *
 * 调用示例：
 *   import File from '../tools/file.js'
 *   await File.read_file.execute({ path: './a.txt' }, { cwd: 'D:/notes' })
 *   await File.read_range.execute({ path: './a.txt', offset: 100000, limit: 50000 }, { cwd: 'D:/notes' })
 *   await File.edit.execute({ path: './a.txt', edits: [{ oldText: 'a', newText: 'b' }] }, { cwd: 'D:/notes' })
 *   await File.snapshot({ sessionId, messageId, toolCallId, toolName: 'write_file', input, cwd })
 *   await File.restoreTool({ sessionId, toolCallId })
 *   const changes = await File.diff({ sessionId })
 */

import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { writeFile as atomicWrite } from 'atomically'
import picomatch from 'picomatch'
import { rgPath } from '@vscode/ripgrep'
import Path from '../utils/path.js'
import fail from '../utils/fail.js'

// --- 搜索和列目录时永远跳过的目录 ---
const SKIP = [
    'node_modules', '.git', 'vendor', '.venv', 'venv', '__pycache__',
    '.cache', '.turbo', '.parcel-cache', '.gradle', '.idea', '.vscode',
    'dist', 'build', 'out', 'target', '.next', '.nuxt', '.output',
    '.svelte-kit', 'coverage',
]
const skipPath = path => String(path).replace(/\\/g, '/').split('/').some(part => SKIP.includes(part))

// --- 搜索输出太长时只留头尾 ---
const truncate = (text, limit = 6000) => {
    if (text.length <= limit) return text
    const half = Math.floor(limit / 2)
    return `${text.slice(0, half)}\n\n...（中间省略 ${text.length - half * 2} 个字符）...\n\n${text.slice(-half)}`
}

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
const filePaths = ({ toolName, input }) => {
    if (toolName === 'write_file') return [input.path]
    if (toolName === 'edit') return input.path ? [input.path] : []
    // move 同时碰源和目标：回退时两处都要恢复成原来的样子。
    if (toolName === 'move_file') return [input.from, input.to]
    if (toolName === 'copy_file') return [input.to]
    return []
}

// =======================================================================
//  文件快照
// =======================================================================

// 快照清单跟着会话走；value 是 { checkpoints: [], redone: [] }。
const manifests = new Map()
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

// --- 退回某条消息之前；点名的工具调用一起退，没有调用 id 的旧快照按消息归属兜底 ---
const restoreMessage = async ({ sessionId, keepMessages, dropToolCalls = [] }) => {
    const manifest = await loadManifest(sessionId)
    const droppedCalls = new Set(dropToolCalls)
    const keepIds = new Set(manifest.checkpoints
        .filter(entry => keepMessages.includes(entry.messageId))
        .filter(entry => !entry.toolCallId || !droppedCalls.has(entry.toolCallId))
        .map(entry => entry.id))
    return restore({ sessionId, keepIds: [...keepIds] })
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
        'For very large files (over ~200K characters) use read_range instead: this tool errors out with the total size.',
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

// --- 分段读取大文件：read_file 读不动的时候用它；offset/limit 按 1-based 行算 ---
// 一次默认 6000 行，和其它工具的输出上限同一量级；续读用上一次返回的 nextOffset。
const readRange = {
    name: 'read_range',
    kind: 'read',
    files: input => [input.path],
    ui: {
        view: 'file-read',
        icon: 'document',
        title: '分段读取',
        summary: '{path}',
        actions: [{ id: 'copy-path', label: '复制路径', icon: 'copy', type: 'copy', value: 'path' }],
    },
    description: [
        'Read a slice of a very large file by line range. Use after read_file reports the file is too large.',
        'Search inside first with search_text to find the interesting lines, then read the surrounding range.',
        'Line numbers are 1-based and included in the output; nextOffset in the result is where the next slice starts.',
        'Parameters: - path (required): file to read. - offset (optional): 1-based starting line, default 1.',
        '- limit (optional): how many lines to return, default 6000, max 20000.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            offset: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 20000 },
        },
        required: ['path'],
    },
    async execute({ path, offset, limit }, options = {}) {
        const target = absolute(path, options.cwd)
        guard([target])
        const file = Bun.file(target)
        if (!await file.exists()) throw new Error(`File not found: ${target}`)

        const text = await file.text()
        const lines = text.split('\n')                                   // 统一按 \n 切，CRLF 的行尾留在行里不影响阅读
        const total = lines.length
        const from = Math.max(1, Math.floor(Number(offset) || 1))
        const size = Math.min(20000, Math.max(1, Math.floor(Number(limit) || 6000)))
        const to = Math.min(total, from - 1 + size)
        const slice = lines.slice(from - 1, to)

        // 行号补在行首，模型引用位置时和 search_text 的行号是同一套。
        const width = String(to).length
        const content = slice.map((line, index) => `${String(from + index).padStart(width)} | ${line.replace(/\r$/, '')}`).join('\n')

        const result = { path: target, total, from, to, content: truncate(content, 120000) }
        if (to < total) result.nextOffset = to + 1
        if (from > total) result.content = ''                            // 越界时返回空段，total 和范围还在，模型能自己修正 offset
        return result
    },
}

// --- 写入完整文本文件 ---
const writeFile = {
    name: 'write_file',
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

// --- 找文件：不带模式就是列目录，带模式就是按名字搜 ---
const findFiles = {
    name: 'find_files',
    kind: 'read',
    files: input => [input.path],
    ui: {
        view: 'file-list',
        icon: 'folder',
        title: '查找文件',
        summary: '{path}',
        actions: [{ id: 'copy-path', label: '复制路径', icon: 'copy', type: 'copy', value: 'path' }],
    },
    description: [
        'List files under a directory, or find files whose names match a glob pattern.',
        'Without pattern: lists immediate children; set recursive to true to walk nested directories. Directories end with /.',
        'With pattern: searches the tree for matching names (e.g. **/*.test.js, src/*.ts). Dependency and build folders are skipped.',
        'Returns paths only, not contents. To search inside files use search_text.',
        'Parameters: - path (required): directory to search in. - pattern (optional): glob pattern for file names. - recursive (optional): walk nested directories when pattern is omitted.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            pattern: { type: 'string' },
            recursive: { type: 'boolean' },
        },
        required: ['path'],
    },
    async execute({ path, pattern, recursive = false }, options = {}) {
        const root = absolute(path, options.cwd)
        guard([root])

        // 带模式：按名字找，返回匹配的路径。Windows 的扫描结果用反斜杠，统一成 /。
        if (pattern) {
            const files = []
            for await (const found of new Bun.Glob(pattern).scan({ cwd: root, dot: true })) {
                const file = found.replace(/\\/g, '/')
                if (skipPath(file)) continue
                files.push(file)
                if (files.length >= 1000) break
            }
            return files
        }

        // 不带模式：列目录；recursive 决定要不要往下走。
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

// --- 搜索文件内容 ---
const searchText = {
    name: 'search_text',
    kind: 'read',
    files: input => [input.path],
    ui: {
        view: 'search',
        icon: 'search',
        title: '搜索内容',
        summary: '{regex}',
        actions: [{ id: 'copy-regex', label: '复制正则', icon: 'copy', type: 'copy', value: 'regex' }],
    },
    description: [
        'Search inside file contents for a regular expression and return the matching lines with file and line number.',
        'Use find_files when you only know part of a file name. This tool reads file contents, not names.',
        'Parameters: - path (required): file or directory to search in. - regex (required): regular expression.',
        '- filePattern (optional): glob filter, e.g. *.js. - context (optional): lines before and after, 0-20.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            regex: { type: 'string' },
            filePattern: { type: 'string' },
            context: { type: 'integer', minimum: 0, maximum: 20 },
        },
        required: ['path', 'regex'],
    },
    async execute({ path, regex, filePattern, context }, options = {}) {
        const needle = regex
        const filter = filePattern
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

// --- 替换文本：一次调用改一个文件，多条修改按顺序应用；全部对上才写盘。改多个文件就同一步并行调多次 ---
const edit = {
    name: 'edit',
    kind: 'write',
    files: input => (input.path ? [input.path] : []),
    snapshot,
    ui: {
        view: 'edit',
        icon: 'edit',
        title: '编辑文件',
        summary: '{path}',
        actions: [{ id: 'copy-path', label: '复制路径', icon: 'copy', type: 'copy', value: 'path' }],
    },
    description: [
        'Replace exact text in one file. Every replacement must match exactly once (unless replaceAll is true), and either all edits succeed or nothing is written.',
        'Read the file first so oldText matches byte-for-byte, including whitespace.',
        'Several edits to the file are applied in order. To change several files, call this tool once per file in the same step.',
        'Line endings are normalized for matching: \\n in oldText also matches CRLF files, and the file keeps its own ending style.',
        'Parameters: - path (required): the file to edit. - edits (required): list of { oldText, newText, replaceAll? }.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            edits: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        oldText: { type: 'string' },
                        newText: { type: 'string' },
                        replaceAll: { type: 'boolean' },
                    },
                    required: ['oldText', 'newText'],
                },
            },
        },
        required: ['path', 'edits'],
    },
    async execute({ path, edits }, options = {}) {
        if (!Array.isArray(edits) || !edits.length) throw new Error('edits must be a non-empty list')

        const target = absolute(path, options.cwd)
        guard([target])
        const file = Bun.file(target)
        if (!await file.exists()) throw new Error(`Cannot edit ${target}: file not found`)

        // 统一成 \n 再匹配：模型写的 oldText 用 \n，不该因为文件是 CRLF 就对不上。
        const original = await file.text()
        const crlfFile = original.includes('\r\n')
        let content = crlfFile ? original.replace(/\r\n/g, '\n') : original
        for (const { oldText, newText, replaceAll } of edits) {
            const from = String(oldText ?? '').replace(/\r\n/g, '\n')
            const to = String(newText ?? '').replace(/\r\n/g, '\n')
            if (!from) throw new Error(`Cannot edit ${target}: oldText must not be empty`)
            const matches = content.split(from).length - 1
            if (!matches) throw new Error(`Cannot edit ${target}: oldText was not found`)
            if (!replaceAll && matches !== 1) throw new Error(`Cannot edit ${target}: oldText must occur exactly once, found ${matches}`)
            content = replaceAll ? content.split(from).join(to) : content.replace(from, () => to)
        }

        // 全部对上才写盘；文件原来是什么行尾，写回去还是什么行尾。
        await mkdir(dirname(target), { recursive: true })
        await atomicWrite(target, crlfFile ? content.replace(/\n/g, '\r\n') : content)
        return `Edited ${target}`
    },
}

// --- 移动或改名：快照记录源和目标两处，回退时两处一起恢复 ---
const moveFile = {
    name: 'move_file',
    kind: 'write',
    files: input => [input.from, input.to],
    snapshot,
    ui: {
        view: 'file-move',
        icon: 'folder',
        title: '移动文件',
        summary: '{from} → {to}',
    },
    description: [
        'Move or rename a file or directory. The parent directory of the destination is created automatically.',
        'Refuses to overwrite an existing destination; delete or move it away first. Protected files (.env, keys, .ssh) are refused for both source and destination.',
        'Snapshots cover both sides: rolling back this call restores the source and removes the copy left at the destination.',
        'Parameters: - from (required): current path. - to (required): new path.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
    },
    async execute({ from, to }, options = {}) {
        if (!from || !to) throw new Error('from and to are required')
        const source = absolute(from, options.cwd)
        const destination = absolute(to, options.cwd)
        guard([source, destination])
        if (source === destination) throw new Error(`Cannot move ${source}: source and destination are the same`)
        // stat 一次同时确认源存在并拿到“是目录还是文件”，供快照回退用。
        const info = await stat(source).catch(() => null)
        if (!info) throw new Error(`Cannot move ${source}: not found`)
        if (await Bun.file(destination).exists()) {
            throw new Error(`Cannot move to ${destination}: already exists`)
        }
        await mkdir(dirname(destination), { recursive: true })
        await rename(source, destination)
        return `Moved ${source} → ${destination}`
    },
}

// --- 复制：目录整个拷过去；目标已存在时拒绝，不悄悄覆盖 ---
const copyFile = {
    name: 'copy_file',
    kind: 'write',
    files: input => [input.to],
    snapshot,
    ui: {
        view: 'file-write',
        icon: 'copy',
        title: '复制文件',
        summary: '{from} → {to}',
    },
    description: [
        'Copy a file or a whole directory to a new path. The parent directory of the destination is created automatically.',
        'Refuses to overwrite an existing destination. Protected files (.env, keys, .ssh) are refused for both source and destination.',
        'Snapshots cover the destination: rolling back this call removes the copy.',
        'Parameters: - from (required): source path. - to (required): destination path.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
    },
    async execute({ from, to }, options = {}) {
        if (!from || !to) throw new Error('from and to are required')
        const source = absolute(from, options.cwd)
        const destination = absolute(to, options.cwd)
        guard([source, destination])
        if (source === destination) throw new Error(`Cannot copy ${source}: source and destination are the same`)
        const info = await stat(source).catch(() => null)
        if (!info) throw new Error(`Cannot copy ${source}: not found`)
        if (await Bun.file(destination).exists()) {
            throw new Error(`Cannot copy to ${destination}: already exists`)
        }
        await mkdir(dirname(destination), { recursive: true })
        await cp(source, destination, { recursive: true })
        return `Copied ${source} → ${destination}`
    },
}
export {
    readFile as read_file,
    readRange as read_range,
    writeFile as write_file,
    findFiles as find_files,
    searchText as search_text,
    edit,
    moveFile as move_file,
    copyFile as copy_file,
    skipPath, sensitive, snapshot, entries,
    restoreTool, restoreMessage, dropTool, undo, clearUndo, diff, remove,
}

export default [readFile, readRange, writeFile, findFiles, searchText, edit, moveFile, copyFile]
