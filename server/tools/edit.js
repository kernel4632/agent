/*
编辑工具：通过精确字符串替换修改文件，不需要重写整个文件。
模型只需要指定"把这段替换成那段"，比覆盖写入更安全更高效。
调用示例：await editTool.execute({ path: 'D:/project/src/index.js', old: 'foo', new: 'bar' }, signal)。
*/
import { readFile, writeFile } from 'node:fs/promises'   // 引入文件读写能力


// --- 精确字符串替换 ---
export const editTool = {
  name: 'edit',
  description: '通过精确字符串匹配替换修改文件。old 必须是文件中存在的完整文本片段，new 是替换后的文本。适用于修改代码、修复 bug、重构等场景。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件绝对路径' },
      old: { type: 'string', description: '要替换的原始文本（必须精确匹配文件中的内容）' },
      new: { type: 'string', description: '替换后的新文本' },
      replaceAll: { type: 'boolean', description: '是否替换全部匹配（默认只替换第一个）', default: false },
    },
    required: ['path', 'old', 'new'],
    additionalProperties: false,
  },
  async execute({ path, old: oldStr, new: newStr, replaceAll = false }, signal) {
    const content = await readFile(path, 'utf-8')       // 读取当前文件内容
    if (!content.includes(oldStr)) throw new Error(`old string not found in ${path}`)
    const updated = replaceAll ? content.replaceAll(oldStr, newStr) : content.replace(oldStr, newStr)
    if (updated === content) throw new Error('replacement produced no change')
    await writeFile(path, updated, 'utf-8')             // 写回修改后的文件
    const count = replaceAll ? (content.split(oldStr).length - 1) : 1
    return { output: `已替换 ${count} 处，文件: ${path}` }
  },
}

export default editTool
