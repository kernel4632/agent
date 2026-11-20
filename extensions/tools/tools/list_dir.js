/*
列目录：只看一层，跳过 node_modules、.git 这类噪音目录。默认不过滤隐藏项。
*/

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { resolvePath, skip } from './common.js'

export default {
    name: 'list_dir',
    description: '列出一个目录下的文件和子目录（一层）。默认跳过常见的依赖和构建目录。',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            cwd: { type: 'string' },
        },
        required: ['path'],
    },
    async run({ path, cwd } = {}) {
        const dir = resolvePath(path, cwd)
        const names = await readdir(dir)
        const entries = []
        for (const name of names) {
            const full = join(dir, name)
            if (skip(full)) continue
            const info = await stat(full).catch(() => null)
            if (!info) continue
            entries.push({ name, type: info.isDirectory() ? 'dir' : 'file', size: info.isDirectory() ? undefined : info.size })
        }
        entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1)
        return { path: dir, entries }
    },
}
