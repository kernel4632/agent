/*
 * 列目录工具：列出直接子项；recursive 为 true 时递归列出相对路径。
 *
 * 名字和参数对齐 Roo Code：list_files({ path, recursive })。
 * 调用示例：模型调用 list_files({ path: 'src', recursive: true })。
 */
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import Skip from '../utils/skip.js' // 递归列目录时跳过依赖和构建产物。

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

export default listFiles
