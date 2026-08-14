/* 旧文本必须唯一，避免模型误改同名片段。 */
import { writeFile } from 'atomically'

export default {
    name: 'edit', description: 'Replace one exact, uniquely occurring text block in a file.',
    inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
        required: ['path', 'oldText', 'newText'], additionalProperties: false,
    },
    async execute({ path, oldText, newText }, context) {
        const content = await Bun.file(path).text()
        const matches = content.split(oldText).length - 1
        if (matches !== 1) throw new Error(`oldText must occur exactly once, found ${matches}`)
        await context.checkpoint(path)
        await writeFile(path, content.replace(oldText, newText))
        return { output: `Edited ${path}` }
    },
}
