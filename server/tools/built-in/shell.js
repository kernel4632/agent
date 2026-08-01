/*
命令工具集：在真实系统 shell 中执行命令并返回标准输出、错误输出和退出码。
危险命令是否允许由统一权限规则决定，本文件只完成被批准后的执行动作。
调用示例：await run_command.execute({ command: 'bun --version', cwd: '.' })。
*/

// --- 执行系统命令 ---
export const run_command = {                                  // 导出模型可调用的命令工具
  description: '在指定工作目录执行系统命令并返回输出。',       // 明确该工具会启动真实子进程
  parameters: {                                               // 定义模型生成参数的业务结构
    command: { type: 'string', description: '要执行的完整命令', required: true }, // 命令正文必须明确提供
    cwd: { type: 'string', description: '工作目录', default: process.cwd() }, // 默认在服务启动目录执行
  },
  async execute({ command, cwd = process.cwd() }, context = {}) {
    context.abortSignal?.throwIfAborted()                       // 已停止 Run 不再创建系统进程
    const shell = process.platform === 'win32' ? ['powershell', '-NoProfile', '-Command'] : ['sh', '-lc'] // 按平台选择真实 shell
    const child = Bun.spawn([...shell, command], { cwd, stdout: 'pipe', stderr: 'pipe' }) // 启动命令并捕获两路输出
    const stopChild = () => child.kill()                            // Run 停止时终止当前真实子进程
    context.abortSignal?.addEventListener('abort', stopChild, { once: true }) // 执行期间监听一次取消
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]) // 并行等待全部结果
    context.abortSignal?.removeEventListener('abort', stopChild)    // 进程结束后释放 Run 信号引用
    context.abortSignal?.throwIfAborted()                           // 被停止的命令不能伪装成正常退出
    return { result: JSON.stringify({ stdout, stderr, exitCode }) } // 用结构化文本反馈完整执行结果
  },
}
