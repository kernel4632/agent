/*
 * 文本编辑工具：把文件里的一段文本替换掉。
 *
 * 名字和参数对齐 Roo Code：edit({ file_path, old_string, new_string, replace_all })。
 * 默认要求旧文本只出现一次；replace_all 为 true 时才替换所有匹配。
 * 工具只处理传入的文件，不操作会话状态。
 */
import { writeFile } from 'atomically' // 用原子替换避免编辑时留下半文件。
import Diagnose from './diagnose.js' // 写完之后跑一次配置里的诊断命令。

export default {
    name: 'edit',
    kind: 'write',
    files: input => [input.file_path],
    ui: {
        view: 'edit',
        icon: 'edit',
        title: '编辑文件',
        summary: '{file_path}',
        actions: [{ id: 'copy-path', label: '复制路径', icon: 'copy', type: 'copy', value: 'file_path' }],
    },
    description: [
        'Replace a specific text block in a file with new text. By default the old block must appear exactly once.',
        'Use this to change part of an existing file — preferred over rewriting the whole file whenever the rest of the content should stay as-is.',
        'Read the file first so old_string matches byte-for-byte, including whitespace and indentation.',
        'If the old text occurs zero or multiple times the edit fails — then read the file again and use a longer, unique block, or set replace_all to true when every occurrence should change.',
        'Parameters:',
        '- file_path (required): file to edit.',
        '- old_string (required): the exact existing text to replace.',
        '- new_string (required): the replacement text.',
        '- replace_all (optional): true to replace every occurrence instead of exactly one.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'file to edit' },
            old_string: { type: 'string', description: 'the exact existing text to replace' },
            new_string: { type: 'string', description: 'the replacement text' },
            replace_all: { type: 'boolean', description: 'replace every occurrence instead of exactly one' },
        },
        required: ['file_path', 'old_string', 'new_string'],
    },
    // --- 替换文本片段 ---
    async execute({ file_path, old_string, new_string, replace_all, path, oldText, newText }) {
        const target = file_path ?? path // 旧调用仍可传 path。
        const before = old_string ?? oldText // 旧调用仍可传 oldText。
        const after = new_string ?? newText // 旧调用仍可传 newText。
        if (!target || typeof before !== 'string' || typeof after !== 'string' || !before) {
            throw new Error('file_path, old_string and new_string are required')
        }

        const content = await Bun.file(target).text() // 读取当前完整文本。
        const matches = content.split(before).length - 1 // 统计目标片段出现次数。
        if (!matches) throw new Error(`old_string was not found in ${target}`)
        if (!replace_all && matches !== 1) throw new Error(`old_string must occur exactly once, found ${matches}`) // 避免改错重复片段。

        const next = replace_all ? content.split(before).join(after) : content.replace(before, after)
        await writeFile(target, next) // 只替换已经验证过的片段。
        return `Edited ${target}${await Diagnose.afterWrite()}` // 返回用户可读的编辑确认，附带诊断。
    },
}
