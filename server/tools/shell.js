/*
Shell 工具：在会话工作区中执行系统命令并返回输出。
子进程通过 context 加入 session.processes，因此 Agent.stop 能统一终止。
调用示例：await shellTool.execute({ command: 'bun --version' }, context)。
*/
import { isAbsolute, resolve } from 'node:path'          // 引入工作目录解析能力


// --- 执行系统命令 ---
export const shellTool = {
  name: 'shell',                                        // LLM 调用使用的稳定工具名
  description: '在指定工作目录执行系统命令并返回标准输出、错误输出和退出码。', // 明确返回完整命令结果
  inputSchema: {
    type: 'object',                                     // 工具输入必须是对象
    properties: {
      command: { type: 'string', description: '完整命令' }, // 要交给系统 Shell 的正文
      cwd: { type: 'string', description: '工作目录，默认当前会话工作区' }, // 可选覆盖工作目录
    },
    required: ['command'],                              // 命令正文必须提供
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ command, cwd }, context) {
    context.abortSignal?.throwIfAborted()               // 已停止会话不再启动子进程
    const directory = cwd ? (isAbsolute(cwd) ? cwd : resolve(context.cwd, cwd)) : context.cwd // 相对 cwd 绑定会话工作区
    const shell = process.platform === 'win32' ? ['powershell', '-NoProfile', '-Command'] : ['sh', '-lc'] // 按平台选择 Shell
    const child = Bun.spawn([...shell, command], { cwd: directory, stdout: 'pipe', stderr: 'pipe' }) // 启动真实子进程
    context.addProcess(child)                           // 让会话记录正在运行的进程
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),              // 并行读取标准输出
        new Response(child.stderr).text(),              // 并行读取错误输出
        child.exited,                                    // 等待真实退出码
      ])
      context.abortSignal?.throwIfAborted()             // 被停止的命令不能伪装成正常完成
      if (exitCode !== 0) throw new Error(JSON.stringify({ stdout, stderr, exitCode })) // 非零退出码必须成为 isError 工具结果
      return { output: { stdout, stderr, exitCode } }    // 返回结构化命令结果
    } finally {
      context.removeProcess(child)                      // 无论成功失败都移除进程引用
    }
  },
}
