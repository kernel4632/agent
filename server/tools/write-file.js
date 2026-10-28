/*
 * 写入文件工具：用完整文本替换文件内容，父目录不存在时自动创建。
 *
 * 名字和参数对齐 Roo Code：write_to_file({ path, content })。
 * 调用示例：模型调用 write_to_file({ path: 'src/a.js', content: 'console.log(1)' })。
 */
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically' // 原子替换完整文本，避免留下半文件。
import Diagnose from '../utils/diagnose.js' // 写完之后跑一次配置里的诊断命令。

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

export default writeToFile
