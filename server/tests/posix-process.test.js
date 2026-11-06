import { describe, test, expect } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Path from '../utils/path.js'
import Shell from '../tools/shell.js'
import { stopProcess, cleanup } from '../utils/process.js'

const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const waitFor = async check => {
    for (let i = 0; i < 200; i++) { if (await check()) return; await Bun.sleep(10) }
    throw new Error('process state did not settle')
}
const fixture = async run => {
    const root = await mkdtemp(join(tmpdir(), 'agent-posix-'))
    const cwd = join(root, '中文 workspace')
    const previous = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)
    let pid
    try {
        await mkdir(cwd)
        const script = join(cwd, 'child.js')
        const marker = join(cwd, 'pid')
        await writeFile(script, `await Bun.write(${JSON.stringify(marker)}, String(process.pid)); console.log('ready'); setInterval(() => {}, 1000)`)
        const command = `"${process.execPath}" "${script}" & wait`
        await run({ cwd, command, marker, getPid: async () => {
            await waitFor(async () => { try { pid = Number(await readFile(marker, 'utf8')); return pid > 0 } catch { return false } })
            return pid
        } })
    } finally {
        cleanup()
        if (pid && alive(pid)) { try { process.kill(pid, 'SIGKILL') } catch {} }
        Path.unlock()
        if (previous === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previous
        await rm(root, { recursive: true, force: true })
    }
}

describe.skipIf(process.platform === 'win32')('POSIX process groups', () => {
    for (const action of ['stop', 'cleanup']) {
        test(`background ${action} terminates descendants in a Unicode path`, async () => fixture(async ({ cwd, command, getPid }) => {
            const started = await Shell.execute({ command, cwd, background: true })
            const pid = await getPid()
            expect(alive(pid)).toBe(true)
            if (action === 'stop') await stopProcess(started.id)
            else cleanup()
            await waitFor(() => !alive(pid))
            expect(alive(pid)).toBe(false)
        }))
    }
    for (const mode of ['abort', 'timeout']) {
        test(`foreground ${mode} closes descendant pipes`, async () => fixture(async ({ cwd, command, getPid }) => {
            const controller = new AbortController()
            const result = Shell.execute({ command, cwd, timeout: mode === 'timeout' ? 1000 : 10000 }, { abortSignal: controller.signal })
            const pid = await getPid()
            if (mode === 'abort') controller.abort()
            const output = await result
            expect(output.timedOut).toBe(mode === 'timeout')
            expect(output.stdout).toContain('ready')
            await waitFor(() => !alive(pid))
        }))
    }
})
