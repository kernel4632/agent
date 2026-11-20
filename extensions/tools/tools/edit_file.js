/*
改文件：按 oldText 精确替换。oldText 必须在文件里只出现一次，避免误改。
改之前留快照。找不到或出现多次时抛错，把上下文回给模型自己决定。
*/

import { readFile, writeFile } from 'node:fs/promises'
import { guard, resolvePath, snapshot } from './common.js'

export default {
    name: 'edit_file',
    description: '把文件里的一段文字精确替换成另一段。oldText 必须只出现一次。不要改密钥或 .env。',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            oldText: { type: 'string' },
            newText: { type: 'string' },
            cwd: { type: 'string' },
        },
        required: ['path', 'oldText', 'newText'],
    },
    async run({ path, oldText, newText, cwd } = {}) {
        if (!oldText) throw new Error('oldText 不能为空')
        const file = guard(resolvePath(path, cwd))
        const text = await readFile(file, 'utf8')
        const count = text.split(oldText).length - 1
        if (count === 0) throw new Error(`在 ${file} 里找不到要替换的文字`)
        if (count > 1) throw new Error(`要替换的文字在 ${file} 里出现了 ${count} 次，请写得更具体`)
        const backup = await snapshot(file)
        await writeFile(file, text.replace(oldText, newText ?? ''))
        return { path: file, snapshot: backup }
    },
}
