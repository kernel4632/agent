/*
精确编辑工具：只在旧文本唯一出现时替换，避免模型误改相同片段。
写入前建立 part 级检查点，替换结果使用原子写保证文件不会半写损坏。
*/
import { writeFile } from 'atomically'
import Checkpoint from '../features/checkpoint.ts'
import type { AgentTool } from '../types.ts'

const edit: AgentTool = {
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
        additionalProperties: false,
    },
    async execute(input, context) {
        const { path, oldText, newText } = input as { path: string; oldText: string; newText: string }
        const content = await Bun.file(path).text()
        const matches = content.split(oldText).length - 1
        if (matches !== 1) throw new Error(`oldText must occur exactly once, found ${matches}`)
        await Checkpoint.save(context.sessionID, context, path)
        await writeFile(path, content.replace(oldText, newText))
        return { output: `Edited ${path}` }
    },
}

export default edit
