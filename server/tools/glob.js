/*
文件查找工具：用 glob 模式匹配文件路径，基于 fast-glob 实现。
比关键词搜索灵活——支持 ** / * / {} 等标准 glob 语法。
调用示例：await globTool.execute({ pattern: 'src/**\/*.test.ts', path: 'D:/project' }, signal)。
*/
import fg from 'fast-glob'                              // 引入高性能 glob 匹配


// --- glob 模式文件查找 ---
export const globTool = {
  name: 'glob',
  description: '用 glob 模式查找文件。支持 ** 递归、* 通配、{a,b} 选择等标准语法。返回匹配的文件绝对路径列表。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'glob 模式，如 "**/*.ts" 或 "src/**/*.{js,jsx}"' },
      path: { type: 'string', description: '搜索目录的绝对路径' },
    },
    required: ['pattern', 'path'],
    additionalProperties: false,
  },
  async execute({ pattern, path }) {
    const matches = await fg(pattern, {
      cwd: path,                                        // 在指定目录下搜索
      absolute: true,                                   // 返回绝对路径
      onlyFiles: true,                                  // 只返回文件
      ignore: ['**/node_modules/**', '**/.git/**'],     // 忽略常见无关目录
    })
    if (matches.length === 0) return { output: '没有找到匹配的文件' }
    const limited = matches.slice(0, 100)               // 最多返回 100 个结果
    const suffix = matches.length > 100 ? `\n...还有 ${matches.length - 100} 个文件未显示` : ''
    return { output: `找到 ${matches.length} 个文件:\n${limited.join('\n')}${suffix}` }
  },
}

export default globTool
