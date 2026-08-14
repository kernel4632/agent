import { dlopen, FFIType } from 'bun:ffi'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
const worker = process.env.AGENT_TOOL_WORKER ?? fileURLToPath(new URL(`./tool-worker.${extension}`, import.meta.url))
const libc = dlopen('libc.so.6', { prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 } })
libc.symbols.prctl(36, 1, 0, 0, 0)
const descendants = (pid: number): number[] => {
    let children: number[] = []
    try { children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number) } catch { return [] }
    return children.flatMap(child => [child, ...descendants(child)])
}

const child = Bun.spawn([process.execPath, worker], {
    stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
    ipc: message => process.send?.(message),
    onExit: process => {
        for (const pid of descendants(process.pid)) try { globalThis.process.kill(pid, 'SIGKILL') } catch {}
        globalThis.process.send?.({ type: 'error', error: `Tool executor exited with code ${process.exitCode}` })
    },
})

process.on('message', message => {
    try { child.send(message) } catch (error) { process.send?.({ type: 'error', error: String(error) }) }
})
