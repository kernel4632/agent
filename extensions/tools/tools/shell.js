/*
跑一条命令。默认超时 30 秒，输出超长时头尾各留一部分。
风险由权限扩展按命令判断；这里只负责执行和截断。
*/

import { spawn } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import { truncate } from './common.js'

const LIMIT = 20000
const DEFAULT_MS = 30000

function run(command, cwd, timeout) {
    return new Promise((ok, fail) => {
        const child = spawn(command, { cwd, shell: true, env: process.env })
        const chunks = { out: '', err: '' }
        const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error(`命令超时（${timeout}ms）：${command}`)) }, timeout)
        child.stdout.on('data', chunk => { chunks.out += chunk })
        child.stderr.on('data', chunk => { chunks.err += chunk })
        child.on('error', error => { clearTimeout(timer); fail(error) })
        child.on('close', code => { clearTimeout(timer); ok({ code, stdout: chunks.out, stderr: chunks.err }) })
    })
}

export default {
    name: 'shell',
    description: '在工作目录执行一条 shell 命令，返回退出码和输出。不要用它读写密钥或 .env。',
    parameters: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
            timeout: { type: 'integer', description: '超时毫秒，默认 30000' },
        },
        required: ['command'],
    },
    async run({ command, cwd, timeout } = {}) {
        if (!command) throw new Error('command 不能为空')
        const dir = cwd && isAbsolute(cwd) ? cwd : resolve(process.cwd(), cwd || '.')
        const result = await run(command, dir, timeout || DEFAULT_MS)
        return { command, cwd: dir, code: result.code, stdout: truncate(result.stdout, LIMIT), stderr: truncate(result.stderr, LIMIT) }
    },
}
