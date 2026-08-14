/*
通用文件工具：读取文本或图片、写入文件、列出目录。
file_read 对图片返回真实 file content，使模型能直接观察像素而不是读取 base64 文本。
*/
import { readdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import Checkpoint from '../features/checkpoint.ts'
import type { AgentTool } from '../types.ts'

const fileRead: AgentTool = {
    name: 'file_read',
    description: 'Read a text file or inspect an image file from any absolute path.',
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
    },
    async execute(input) {
        const { path } = input as { path: string }
        const file = Bun.file(path)
        if (!(await file.exists())) throw new Error(`File not found: ${path}`)
        const mediaType = file.type || 'application/octet-stream'
        if (mediaType.startsWith('image/')) {
            return { output: { path, mediaType, data: Buffer.from(await file.arrayBuffer()).toString('base64') } }
        }
        return { output: await file.text() }
    },
    toModelOutput(output) {
        if (typeof output === 'string') return { type: 'text', value: output }
        const image = output as { path: string; mediaType: string; data: string }
        return {
            type: 'content',
            value: [
                { type: 'text', text: `Image read from ${image.path}` },
                { type: 'file', data: { type: 'data', data: image.data }, mediaType: image.mediaType },
            ],
        }
    },
}

const fileWrite: AgentTool = {
    name: 'file_write',
    description: 'Write complete text content to any file, creating parent directories when needed.',
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false,
    },
    async execute(input, context) {
        const { path, content } = input as { path: string; content: string }
        await Checkpoint.save(context.sessionID, context, path)
        await writeFile(path, content)
        return { output: `Wrote ${Buffer.byteLength(content)} bytes to ${path}` }
    },
}

const fileList: AgentTool = {
    name: 'file_list',
    description: 'List files and directories directly inside any directory.',
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
    },
    async execute(input) {
        const { path } = input as { path: string }
        const entries = await readdir(path, { withFileTypes: true })
        return { output: entries.map(entry => `${entry.name}${entry.isDirectory() ? '/' : ''}`) }
    },
}

export default [fileRead, fileWrite, fileList]
