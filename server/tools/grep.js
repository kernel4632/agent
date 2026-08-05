/*
内容搜索工具：用正则表达式搜索文件内容，基于 ripgrep 实现。
比文件名搜索强得多——可以找到"哪些文件包含某个函数调用"等。
调用示例：await grepTool.execute({ pattern: 'import.*session', path: 'D:/project/src' }, signal)。
*/
import { execa } from 'execa'                           // 引入跨平台命令执行
import { rgPath } from '@vscode/ripgrep'                // 引入内置 ripgrep 二进制路径


// --- 正则内容搜索 ---
export const grepTool = {
  name: 'grep',
  description: '用正则表达式搜索文件内容。返回匹配的文件路径、行号和内容。支持 include 过滤文件类型。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '正则表达式模式' },
      path: { type: 'string', description: '搜索目录的绝对路径' },
      include: { type: 'string', description: '文件过滤模式，如 "*.js" 或 "*.{ts,tsx}"' },
    },
    required: ['pattern', 'path'],
    additionalProperties: false,
  },
  async execute({ pattern, path, include }, signal) {
    const args = ['--no-heading', '--line-number', '--color', 'never', '--max-count', '100']
    if (include) args.push('--glob', include)
    args.push(pattern, path)

    const { stdout, exitCode } = await execa({
      reject: false,
      cancelSignal: signal,
      forceKillAfterDelay: 3000,
    })`${rgPath} ${args}`

    if (exitCode === 1) return { output: '没有找到匹配结果' }  // ripgrep 退出码 1 表示无匹配
    if (exitCode !== 0 && exitCode !== 1) throw new Error(`grep failed with exit code ${exitCode}: ${stdout}`)

    const lines = stdout.trim().split('\n').filter(Boolean)
    return { output: `找到 ${lines.length} 个匹配:\n${lines.join('\n')}` }
  },
}

export default grepTool
