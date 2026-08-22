/* 读取文本或图片、完整写文件、列目录。每个工具都是目录发现的独立业务对象。 */
import { mkdir, readdir } from 'node:fs/promises' // 创建父目录并读取目录条目。
import { dirname } from 'node:path' // 从目标文件计算父目录。
import { writeFile } from 'atomically' // 原子写入完整文本文件。

const fileRead = { // 文本与图片读取共用一个工具名。
    name: 'file_read',
    description: 'Read a text file or inspect an image file.',
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

        return { output: await file.text() } // 文本直接作为工具结果返回。
    },
    toModelOutput(output) {
        if (typeof output === 'string') {
            return { type: 'text', value: output } // 文本无需额外转换。
        }

        return { type: 'content', value: [
            { type: 'text', text: `Image read from ${output.path}` },
            { type: 'file', data: { type: 'data', data: output.data }, mediaType: output.mediaType },
        ] }
    },
}

const fileWrite = { // 完整替换一个文本文件。
    name: 'file_write',
    description: 'Write complete text content, creating parent directories.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            content: { type: 'string' },
        },
        required: ['path', 'content'],
        
    },
    async execute({ path, content }) {
        // 文件写入前先记录旧内容，再创建目录并原子替换文件。
        await mkdir(dirname(path), { recursive: true }) // 新文件允许自动创建父目录。
        await writeFile(path, content) // 一次原子替换全部文本。
        return { output: `Wrote ${Buffer.byteLength(content)} bytes to ${path}` } // 报告实际写入字节数。
    },
}

const fileList = { // 只列出当前目录的直接子项。
    name: 'file_list',
    description: 'List files and directories directly inside a directory.',
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        
    },
    async execute({ path }) {
        const entries = await readdir(path, { withFileTypes: true }) // 同时取得每项是否目录。
        return { output: entries.map(entry => `${entry.name}${entry.isDirectory() ? '/' : ''}`) } // 用斜杠标记目录。
    },
}

export default [fileRead, fileWrite, fileList] // 一个文件导出三个文件系统工具。
