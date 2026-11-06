import { expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Path from '../utils/path.js'
import Session from '../commands/session.js'
import { start } from '../server.js'

test('compact HTTP response survives the server idle timeout', async () => {
    const home = join(tmpdir(), `agent-compact-http-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    const compact = Session.compact
    await mkdir(home, { recursive: true })
    process.env.AGENT_HOME = home
    Path.lock(home)
    let app
    try {
        Session.compact = async ({ sessionId }) => {
            await Bun.sleep(1800)
            return { id: sessionId, content: 'delayed summary' }
        }
        app = await start({ port: 0 })
        app.server.reload({ idleTimeout: 1 })
        const response = await fetch(`http://127.0.0.1:${app.server.port}/session/compact/delayed`, { method: 'POST', signal: AbortSignal.timeout(5000) })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ id: 'delayed', content: 'delayed summary' })
    } finally {
        await app?.stop(true)
        Session.compact = compact
        Path.unlock()
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(home, { recursive: true, force: true })
    }
}, 10000)
