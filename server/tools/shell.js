/*
Shell 工具：在会话工作区中执行系统命令并返回输出。
path 是 Shell 自己的工作路径参数，停止信号会直接终止子进程。
调用示例：await shellTool.execute({ command: 'bun --version', path: 'D:/project' }, signal)。
*/


// --- 执行系统命令 ---
export const shellTool = {
  name: 'shell',                                        // LLM 调用使用的稳定工具名
  description: process.platform === 'win32'
    ? '在 Windows PowerShell 5.1 中执行命令并返回标准输出、错误输出和退出码。command 会直接传给 powershell -NoProfile -Command，不要再次嵌套 powershell，不要使用 sed、grep 或 &&；多个命令请用分号连接。' // Windows 模型必须使用当前真实 Shell 语法
    : '在 POSIX sh 中执行命令并返回标准输出、错误输出和退出码。command 会直接传给 sh -lc。', // Unix 模型使用标准 Shell 语法
  parameters: {
    type: 'object',                                     // 工具输入必须是对象
    properties: {
      command: { type: 'string', description: '完整命令' }, // 要交给系统 Shell 的正文
      path: { type: 'string', description: '命令执行的绝对路径' }, // 模型必须提供工作目录
    },
    required: ['command', 'path'],                       // 命令和工作路径都必须提供
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ command, path }, signal) {
    signal.throwIfAborted()                              // 已停止任务不再启动子进程
    const shell = process.platform === 'win32' ? ['powershell', '-NoProfile', '-Command'] : ['sh', '-lc'] // 按平台选择 Shell
    const child = Bun.spawn([...shell, command], { cwd: path, stdout: 'pipe', stderr: 'pipe' }) // 启动真实子进程
    signal.addEventListener('abort', () => child.kill(), { once: true }) // tool.abort 直接终止当前命令
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),                // 并行读取标准输出
      new Response(child.stderr).text(),                // 并行读取错误输出
      child.exited,                                      // 等待真实退出码
    ])
    signal.throwIfAborted()                              // 被停止的命令不能伪装成正常完成
    if (exitCode !== 0) throw new Error(JSON.stringify({ stdout, stderr, exitCode })) // 非零退出码必须成为 isError 工具结果
    return { output: { stdout, stderr, exitCode } }      // 返回结构化命令结果
  },
}

export default shellTool                             // 让 utils/Tool.scan 自动注册 Shell 工具
