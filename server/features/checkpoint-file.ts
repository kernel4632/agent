import { chmod, mkdir, readFile } from 'node:fs/promises'
import { writeFile } from 'atomically'
import type { CheckpointEntry, CheckpointPosition } from '../types.ts'
import Path from '../utils/path.ts'
import Store from '../store.ts'

const list = async (sessionID: string) => {
    const text = await readFile(Path.checkpoints(sessionID), 'utf8').catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? '' : Promise.reject(error))
    return text.split('\n').filter(Boolean).map((line, index) => {
        try { return JSON.parse(line) as CheckpointEntry } catch { throw new globalThis.Error(`Invalid JSONL at ${Path.checkpoints(sessionID)}:${index + 1}`) }
    })
}

const save = (sessionID: string, position: CheckpointPosition, path: string) => Store.runtimes[sessionID]!.writes.add(async () => {
    const entries = await list(sessionID)
    const sequence = (entries.at(-1)?.sequence ?? 0) + 1
    const file = Bun.file(path)
    const existed = await file.exists()
    const snapshot = existed ? `${Path.snapshots(sessionID)}/${sequence}` : undefined
    if (snapshot) {
        await mkdir(Path.snapshots(sessionID), { recursive: true, mode: 0o700 })
        await Bun.write(snapshot, file)
        await chmod(snapshot, 0o600)
    }
    const entry: CheckpointEntry = { ...position, sequence, path, existed, snapshot }
    await writeFile(Path.checkpoints(sessionID), `${[...entries, entry].map(item => JSON.stringify(item)).join('\n')}\n`, { mode: 0o600 })
    await chmod(Path.checkpoints(sessionID), 0o600)
    return entry
})

export default { list, save }
