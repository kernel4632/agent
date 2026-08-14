import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import Path from '../utils/path.ts'
import type { PluginModule } from '../types.ts'

const builtIn = resolve(dirname(fileURLToPath(import.meta.url)), '../plugins')
const list = async (name?: string) => {
    const files: string[] = []
    for (const directory of [builtIn, Path.plugins()]) {
        if (!await stat(directory).then(value => value.isDirectory()).catch(() => false)) continue
        for await (const file of new Bun.Glob('*/index.{js,ts}').scan({ cwd: directory, absolute: true, onlyFiles: true })) {
            if (!name || file.split('/').at(-2) === name) files.push(file)
        }
    }
    if (name && !files.length) throw new Error(`Plugin not found: ${name}`)
    return files
}
const create = async (path: string, api: Record<string, unknown>) => {
    const factory = (await import(`${path}?v=${(await stat(path)).mtimeMs}`)).default as (api: Record<string, unknown>) => PluginModule | Promise<PluginModule>
    return factory(api)
}
const hosted = (path: string) => path.startsWith(`${builtIn}/`)

export default { list, create, hosted }
