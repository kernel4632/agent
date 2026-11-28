/*
写文件：覆盖写出。若目标已存在，先在同目录 .agent/snapshots 里留一份原件。
敏感文件直接拒绝。
*/

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { guard, resolvePath, snapshot } from './common.js'

export default {
    name: 'write_file',
    description: '把内容写入一个文件（覆盖）。相对路径落在框架准备的沙箱目录里；父目录不存在会自动创建。已有文件会先做快照再写。不要用来写密钥或 .env。',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            content: { type: 'string' },
            cwd: { type: 'string' },
        },
        required: ['path', 'content'],
    },
    /** @param {{ path?: string, content?: string, cwd?: string }} [args] */
    async run({ path, content, cwd } = {}) {
        const file = guard(resolvePath(path, cwd))
        const backup = await snapshot(file)
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, content ?? '')
        return { path: file, bytes: Buffer.byteLength(content ?? ''), ...(backup ? { snapshot: backup } : {}) }
    },
}
