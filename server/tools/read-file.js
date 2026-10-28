/*
 * 读取文件工具：返回文件原文；图片则返回可交给模型的图片内容。
 *
 * 名字和参数对齐 Roo Code：read_file({ path })。
 * 调用示例：模型调用 read_file({ path: 'src/main.js' })。
 */

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

export default readFile
