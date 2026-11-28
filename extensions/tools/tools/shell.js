/*
跑一条命令。默认超时 30 秒，输出超长时头尾各留一部分。
风险由权限扩展按命令判断；这里只负责执行和截断。
*/

import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { truncate } from './common.js'

const LIMIT = 20000
const DEFAULT_MS = 30000

/** @param {string} command @param {string} cwd @param {number} timeout @returns {Promise<{ code: number, stdout: string, stderr: string }>} */
function run(command, cwd, timeout) {
    return new Promise((ok, fail) => {
        const child = spawn(command, { cwd, shell: true, env: process.env })
        const chunks = { out: '', err: '' }
        const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error(`命令超时（${timeout}ms）：${command}`)) }, timeout)
        child.stdout.on('data', (/** @type {string} */ chunk) => { chunks.out += chunk })
        child.stderr.on('data', (/** @type {string} */ chunk) => { chunks.err += chunk })
        child.on('error', (/** @type {Error} */ error) => { clearTimeout(timer); fail(error) })
        child.on('close', (/** @type {number} */ code) => { clearTimeout(timer); ok({ code, stdout: chunks.out, stderr: chunks.err }) })
    })
}

export default {
    name: 'shell',
    description: '在宿主系统执行一条命令，返回退出码和输出。命令由宿主的系统 shell 解释（Windows 是 cmd.exe，Unix 是 /bin/sh）：注意平台差异——Windows 下目录用反斜杠、没有 mkdir -p / ls -la / pwd 等 Unix 命令。默认工作目录是框架准备的沙箱目录（返回值里的 cwd），写文件优先用 write_file 工具而不是命令。每次调用都会真实执行：不要用 echo / printf 之类的探测命令反复探路，信息拿一次就够。不要用它读写密钥或 .env。',
    parameters: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
            timeout: { type: 'integer', description: '超时毫秒，默认 30000' },
        },
        required: ['command'],
    },
    /** @param {{ command?: string, cwd?: string, timeout?: number }} [args] */
    async run({ command, cwd, timeout } = {}) {
        if (!command) throw new Error('command 不能为空')
        const dir = cwd && isAbsolute(cwd) ? cwd : resolve(process.env.AGENT_SANDBOX || join(tmpdir(), 'agent-sandbox'), cwd || '.')
        const result = await run(command, dir, timeout || DEFAULT_MS)
        return { command, cwd: dir, code: result.code, stdout: truncate(result.stdout, LIMIT), stderr: truncate(result.stderr, LIMIT) }
    },
}
