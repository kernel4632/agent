/*
 * 多文件补丁工具：一次改多个文件，任一文件失败就整体不改。
 *
 * 为什么不是"再调一次 edit"：模型改 5 个文件要发 5 次 edit，中途失败就在磁盘上留下半个改动，
 * 用户看到的是"改了一半"的代码。apply_patch 先全部校验，通过才统一落盘。
 * 调用示例：模型调用 apply_patch({
 *   patches: [
 *     { path: 'src/a.js', oldText: '旧', newText: '新' },
 *     { path: 'src/b.js', oldText: '旧', newText: '新' },
 *   ],
 * })
 */
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically' // 原子替换，避免写入中断留下半文件。

export default {
    name: 'apply_patch',
    description: [
        'Apply several exact-match text replacements across multiple files in one atomic step: either every edit succeeds, or nothing is written.',
        'Use this when one logical change touches several files at once, so related files never end up half-updated.',
        'Each old block must appear exactly once within its file. All files are checked before anything is written; if any block is missing or ambiguous, nothing changes and the failure is reported.',
        'Read the involved files first so every oldText matches byte-for-byte.',
        'Parameters:',
        '- patches (required): list of edits; each entry is path, oldText (exact existing text), newText (replacement).',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            patches: {
                type: 'array',
                description: 'edits to apply; each entry has path, oldText, newText',
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        oldText: { type: 'string' },
                        newText: { type: 'string' },
                    },
                    required: ['path', 'oldText', 'newText'],
                },
            },
        },
        required: ['patches'],
    },

    // --- 先全部校验，再统一落盘 ---
    async execute({ patches }) {
        const prepared = []

        // 第一轮只读不改：任何一处对不上，后面一个字节都不会写。
        for (const { path, oldText, newText } of patches) {
            const file = Bun.file(path)
            if (!await file.exists()) throw new Error(`Cannot patch ${path}: file not found`)

            const content = await file.text()
            const matches = content.split(oldText).length - 1
            // 0 处说明模型记错了原文，多处说明这段代码在文件里不唯一，两种都不能猜着改。
            if (matches !== 1) throw new Error(`Cannot patch ${path}: oldText must occur exactly once, found ${matches}`)

            prepared.push({ path, content: content.replace(oldText, newText) })
        }

        // 第二轮才写盘，此时每个文件都已经确认可以改。
        for (const { path, content } of prepared) {
            await mkdir(dirname(path), { recursive: true })
            await writeFile(path, content)
        }
        return `Patched ${prepared.length} file(s): ${prepared.map(item => item.path).join(', ')}`
    },
}
