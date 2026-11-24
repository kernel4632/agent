/*
读文件：整份过长时按行分段，结果里带 nextOffset，让模型接着读。
敏感文件直接拒绝。
*/

import { readFile } from 'node:fs/promises'
import { guard, resolvePath, truncate } from './common.js'

const WHOLE = 200000
const DEFAULT_LINES = 4000

export default {
    name: 'read_file',
    description: '读取一个文本文件。可以按行分段（offset / limit）。不要用来读密钥、证书或 .env。',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            cwd: { type: 'string', description: '相对路径的起点，默认进程当前目录' },
            offset: { type: 'integer', description: '从第几行开始（从 1 计）' },
            limit: { type: 'integer', description: '最多读多少行' },
        },
        required: ['path'],
    },
    /** @param {{ path?: string, cwd?: string, offset?: number, limit?: number }} [args] */
    async run({ path, cwd, offset, limit } = {}) {
        const file = guard(resolvePath(path, cwd))
        const text = await readFile(file, 'utf8')
        const lines = text.split('\n')
        const start = Math.max(1, offset || 1)
        const want = limit || (text.length > WHOLE ? DEFAULT_LINES : lines.length)
        const slice = lines.slice(start - 1, start - 1 + want)
        const next = start + slice.length <= lines.length ? start + slice.length : undefined
        return { path: file, totalLines: lines.length, offset: start, content: truncate(slice.join('\n'), WHOLE), ...(next ? { nextOffset: next } : {}) }
    },
}
