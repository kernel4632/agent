/*
 * 文本编辑工具：把文件里唯一出现的一段文本替换掉。
 *
 * 工具只处理传入的文件，不操作会话状态。
 * 调用示例：模型调用 edit({ path: 'src/a.js', oldText: '旧代码', newText: '新代码' })。
 */
import { writeFile } from 'atomically' // 用原子替换避免编辑时留下半文件。

export default {
    name: 'edit',
    description: 'Replace one exact, uniquely occurring text block in a file.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            oldText: { type: 'string' },
            newText: { type: 'string' },
        },
        required: ['path', 'oldText', 'newText'],
    },
    // --- 替换唯一文本片段 ---
    async execute({ path, oldText, newText }) {
        const content = await Bun.file(path).text() // 读取当前完整文本。
        const matches = content.split(oldText).length - 1 // 统计目标片段出现次数。
        if (matches !== 1) throw new Error(`oldText must occur exactly once, found ${matches}`) // 避免改错重复片段。
        await writeFile(path, content.replace(oldText, newText)) // 只替换已验证的唯一片段。
        return `Edited ${path}` // 返回用户可读的编辑确认。
    },
}
