/*
 * 文件工具：读取文件、写入完整文本、列出目录。
 *
 * 名字和参数对齐 Roo Code：read_file / write_to_file / list_files。
 * 三个工具共用文件领域，每个工具只做一个动作。
 * 调用示例：模型调用 read_file({ path: 'a.txt' }) / write_to_file({ path, content }) / list_files({ path, recursive: true })。
 */
import { mkdir, readdir } from 'node:fs/promises' // 创建父目录并读取目录条目。
import { dirname, join, relative } from 'node:path' // 从目标文件计算父目录，拼出递归列表的相对路径。
import { writeFile } from 'atomically' // 原子写入完整文本文件。
import Skip from '../utils/skip.js' // 递归列目录时跳过依赖和构建产物。
import Diagnose from '../utils/diagnose.js' // 写完之后跑一次配置里的诊断命令。

// --- 读取文本或图片 ---
const readFileTool = {
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
        'Use this whenever you need to know what is inside a file: before editing it, before referencing it, or when the user asks about it.',
        'Do not guess file contents from names — read first, then act.',
        'Parameters:',
        '- path (required): file to read.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
    },
    async execute({ path }) {
        const file = Bun.file(path) // 延迟打开用户指定路径。
        if (!await file.exists()) throw new Error(`File not found: ${path}`) // 不把不存在路径伪装为空文本。

        const mediaType = file.type || 'application/octet-stream' // 无法识别时按普通二进制处理。
        if (mediaType.startsWith('image/')) {
            const data = Buffer.from(await file.arrayBuffer()).toString('base64') // 图片转为消息可携带的文本。
            return { output: { path, mediaType, data } } // 下轮模型可收到真实图片内容。
        }

        return await file.text() // 文本直接作为工具结果返回。
    },
    toModelOutput({ output }) {
        if (typeof output === 'string') return { type: 'text', value: output } // 文本无需额外转换。

        // 图片交给模型时说明来源，并带上图片本身。
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
    ui: {
        view: 'file-write',
        icon: 'edit',
        title: '写入文件',
        summary: '{path}',
        actions: [{ id: 'copy-path', label: '复制路径', icon: 'copy', type: 'copy', value: 'path' }],
    },
    description: [
        'Write the complete new content of a file, replacing whatever was there before. Parent directories are created automatically.',
        'Use this to create a new file, or to rewrite a file entirely from scratch.',
        'You must supply the FULL content — partial content will overwrite and destroy the rest of the file. To change only part of a file, use the edit tool instead.',
        'Parameters:',
        '- path (required): file to write.',
        '- content (required): the complete new content of the file.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            content: { type: 'string' },
        },
        required: ['path', 'content'],
    },
    async execute({ path, content }) {
        await mkdir(dirname(path), { recursive: true }) // 新文件允许自动创建父目录。
        await writeFile(path, content) // 一次原子替换全部文本。
        return `Wrote ${Buffer.byteLength(content)} bytes to ${path}${await Diagnose.afterWrite()}` // 报告实际写入字节数，附带诊断。
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
        'Use this to discover what exists somewhere before reading specific files, or to locate a file you only know the approximate location of.',
        'Set recursive to true to walk nested directories; the default only lists direct children.',
        'Parameters:',
        '- path (required): directory to list.',
        '- recursive (optional): true to include nested files and directories.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            recursive: { type: 'boolean' },
        },
        required: ['path'],
    },
    async execute({ path, recursive = false }) {
        if (!recursive) {
            const entries = await readdir(path, { withFileTypes: true }) // 同时取得每项是否目录。
            return entries.map(entry => `${entry.name}${entry.isDirectory() ? '/' : ''}`) // 用斜杠标记目录。
        }

        const entries = [] // 递归时返回相对路径，避免整条绝对路径重复出现。
        const walk = async directory => {
            const children = await readdir(directory, { withFileTypes: true })
            for (const entry of children) {
                const absolute = join(directory, entry.name)
                const relativePath = relative(path, absolute).replace(/\\/g, '/')
                if (Skip.listing(relativePath)) continue // 依赖和构建产物不列给模型。
                entries.push(`${relativePath}${entry.isDirectory() ? '/' : ''}`)
                if (entry.isDirectory()) await walk(absolute)
            }
        }
        await walk(path)
        return entries
    },
}

export default [readFileTool, writeToFile, listFiles] // 一个文件导出三个文件系统工具。
