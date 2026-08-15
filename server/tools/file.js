/* 读取文本或图片、完整写文件、列目录。每个工具都是目录发现的独立业务对象。 */
import { mkdir, readdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'

const fileRead = {
    name: 'file_read',
    description: 'Read a text file or inspect an image file.',
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
    },
    async execute({ path }) {
        const file = Bun.file(path)
        if (!await file.exists()) throw new Error(`File not found: ${path}`)

        const mediaType = file.type || 'application/octet-stream'
        if (mediaType.startsWith('image/')) {
            const data = Buffer.from(await file.arrayBuffer()).toString('base64')
            return { output: { path, mediaType, data } }
        }

        return { output: await file.text() }
    },
    toModelOutput(output) {
        if (typeof output === 'string') {
            return { type: 'text', value: output }
        }

        return { type: 'content', value: [
            { type: 'text', text: `Image read from ${output.path}` },
            { type: 'file', data: { type: 'data', data: output.data }, mediaType: output.mediaType },
        ] }
    },
}

const fileWrite = {
    name: 'file_write',
    description: 'Write complete text content, creating parent directories.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            content: { type: 'string' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
    },
    async execute({ path, content }, context) {
        // 文件写入前先记录旧内容，再创建目录并原子替换文件。
        await context.checkpoint(path)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content)
        return { output: `Wrote ${Buffer.byteLength(content)} bytes to ${path}` }
    },
}

const fileList = {
    name: 'file_list',
    description: 'List files and directories directly inside a directory.',
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
    },
    async execute({ path }) {
        const entries = await readdir(path, { withFileTypes: true })
        return { output: entries.map(entry => `${entry.name}${entry.isDirectory() ? '/' : ''}`) }
    },
}

export default [fileRead, fileWrite, fileList]
