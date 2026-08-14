/*
配置指令：从明文文件加载、读取和局部更新 Agent 配置。
调用示例：Config.load()、Config.read()、Config.save({ context: { idleRounds: 2 } })。
*/
import { chmod, mkdir, readFile } from 'node:fs/promises'
import { writeFile } from 'atomically'
import { deepmergeCustom } from 'deepmerge-ts'
import * as v from 'valibot'
import Store from '../store.ts'
import Path from '../utils/path.ts'
import type { ConfigData } from '../types.ts'

let saving = Promise.resolve()
const positive = v.pipe(v.number(), v.minValue(1))
const schema = v.object({
    auth: v.object({ username: v.string(), password: v.string() }),
    providers: v.array(v.object({
        name: v.pipe(v.string(), v.minLength(1)), baseURL: v.pipe(v.string(), v.url()), key: v.string(),
        models: v.array(v.object({ id: v.pipe(v.string(), v.minLength(1)), contextWindow: positive, maxOutput: positive })),
    })),
    prompts: v.object({ system: v.string(), tool: v.string(), summary: v.string() }),
    retry: v.object({ baseDelay: positive, factor: positive, maxDelay: positive }),
    context: v.object({ compactRatio: v.pipe(v.number(), v.minValue(0.01), v.maxValue(1)), idleRounds: v.pipe(v.number(), v.integer(), v.minValue(0)) }),
    permission: v.array(v.object({ tool: v.string(), match: v.string(), action: v.union([v.literal('allow'), v.literal('ask')]) })),
    plugins: v.record(v.string(), v.object({ enabled: v.boolean(), settings: v.optional(v.unknown()) })),
})

const load = async () => {
    await mkdir(Path.root(), { recursive: true, mode: 0o700 })
    await chmod(Path.root(), 0o700)
    await mkdir(Path.sessions(), { recursive: true, mode: 0o700 })
    const file = await readFile(Path.config(), 'utf8').catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
        throw error
    })
    let saved: ConfigData = Store.defaults
    if (file) {
        try {
            saved = JSON.parse(file)
        } catch {
            throw new globalThis.Error(`Invalid JSON: ${Path.config()}`)
        }
    }
    const merge = deepmergeCustom({ mergeArrays: values => values.at(-1) })
    Store.config = v.parse(schema, merge(structuredClone(Store.defaults), saved)) as ConfigData
    await writeFile(Path.config(), JSON.stringify(Store.config, null, 2), { mode: 0o600 })
    await chmod(Path.config(), 0o600)
    return Store.config
}

const read = () => structuredClone(Store.config)

const save = async (patch: Partial<ConfigData>) => {
    const previous = saving
    let release = () => {}
    saving = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
        const merge = deepmergeCustom({ mergeArrays: values => values.at(-1) })
        const config = v.parse(schema, merge(Store.config, patch)) as ConfigData
        await writeFile(Path.config(), JSON.stringify(config, null, 2), { mode: 0o600 })
        await chmod(Path.config(), 0o600)
        Store.config = config
        return read()
    } finally {
        release()
    }
}

export default { load, read, save }
