/*
 * 扩展加载器：扫描扩展、调用后端入口、记录改动以支持拔出、打包前端代码。
 *
 * 扩展通过 ctx.patch / ctx.op 修改框架，加载器记下每一处改动，关闭时逐条恢复。
 * 扩展放在两处，同名时用户目录的覆盖项目里的：
 *   <项目根>/extensions/<名字>/extension.js      跟项目一起发布
 *   ~/.agents/extensions/<名字>/extension.js     用户自己装的，所有项目共用
 *
 * 扩展声明文件 extension.js 导出 { id, requires?, backend?, frontend? }。
 * backend 默认 'backend.js'，导出一个函数，接收 ctx：
 *   export default ctx => {
 *       ctx.patch(Tool, 'build', original => async args => { ... })
 *       ctx.op('skill.list', params => Skills.list(params))
 *   }
 *
 * 扩展里引用框架模块：
 *   import Tool from '@agent/features/tool.js'   // @agent/ 指向 server/
 *   import matter from 'gray-matter'              // 先找扩展自己的 node_modules
 *
 * 调用示例：
 *   await Extension.load()                           // server.js 启动时调一次
 *   const code = await Extension.buildFrontend('skill')  // 打包扩展前端代码
 */

import { readdir, watch } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, sep } from 'node:path'
import { homedir } from 'node:os'
const serverDir = fileURLToPath(new URL('../', import.meta.url))
const projectDir = () => join(dirname(serverDir), 'extensions')
const userDir = () => join(process.env.HOME || process.env.USERPROFILE || homedir(), '.agents', 'extensions')

// --- 加载状态 ---
const extensions = new Map()   // id → { dir, config, patches, ops, disposers, enabled }
const resolverRoots = []
const failedList = []           // { name, error }

// --- @agent/ 别名和包回退 ---
const inside = (file, root) => file.toLowerCase().startsWith((root + sep).toLowerCase())
let resolverReady = false
const installResolver = () => {
    if (resolverReady) return
    resolverReady = true
    Bun.plugin({
        name: 'agent-extensions',
        setup(build) {
            build.onResolve({ filter: /^@agent\// }, args => ({ path: join(serverDir, args.path.slice('@agent/'.length)) }))
            build.onResolve({ filter: /^[^./\\]/ }, args => {
                if (args.path.includes(':') || !args.importer) return undefined
                if (!resolverRoots.some(root => inside(args.importer, root))) return undefined
                try { return { path: Bun.resolveSync(args.path, dirname(args.importer)) } } catch {}
                try { return { path: Bun.resolveSync(args.path, serverDir) } } catch {}
                return undefined
            })
        },
    })
}

// --- 扫描扩展目录：有 extension.js 的算一个扩展 ---
const scan = async root => {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    const found = []
    for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const dir = join(root, entry.name)
        const manifest = join(dir, 'extension.js')
        if (await Bun.file(manifest).exists()) found.push({ name: entry.name, dir, manifest })
    }
    return found
}

// --- 依赖排序：拓扑排序，被依赖的先加载 ---
const sort = entries => {
    const map = new Map(entries.map(e => [e.name, e]))
    const sorted = []
    const visiting = new Set()
    const done = new Set()
    const visit = name => {
        if (done.has(name)) return
        if (visiting.has(name)) throw new Error(`扩展依赖循环：${name}`)
        visiting.add(name)
        const entry = map.get(name)
        if (entry?.config?.requires) {
            for (const dep of entry.config.requires) {
                if (map.has(dep)) visit(dep)
                else throw new Error(`缺少依赖：${dep}`)
            }
        }
        visiting.delete(name)
        done.add(name)
        if (entry) sorted.push(entry)
    }
    for (const entry of entries) visit(entry.name)
    return sorted
}

// --- 创建 ctx：扩展通过它修改框架，加载器记下每一处改动 ---
// Admin.OPS 由 load() 调用时传入，避免 feature 层 import commands 层
let adminOps = null

const createCtx = id => {
    const patches = []          // { obj, key, original }
    const ops = []              // { name, original }
    const disposers = []        // () => void

    const ctx = {
        patch(obj, key, wrapper) {
            const original = obj[key]
            patches.push({ obj, key, original })
            obj[key] = wrapper(original)
        },
        op(opName, handler) {
            if (!adminOps) throw new Error('ctx.op() 在 load() 调用前不可用')
            const original = adminOps[opName]
            ops.push({ opName, original })
            adminOps[opName] = handler
        },
        onDispose(fn) { disposers.push(fn) },
        id,
    }
    return { ctx, patches, ops, disposers }
}

// --- 卸载一个扩展：逐条恢复改动 ---
const unload = async id => {
    const ext = extensions.get(id)
    if (!ext) return
    const { patches, ops, disposers } = ext
    for (const fn of disposers) try { fn() } catch (e) { console.error(`[extensions] ${id} onDispose: ${e.message}`) }
    if (adminOps) {
        for (const { opName, original } of ops) {
            if (original === undefined) delete adminOps[opName]
            else adminOps[opName] = original
        }
    }
    for (const { obj, key, original } of patches.reverse()) obj[key] = original
    extensions.delete(id)
    console.log(`[extensions] ${id} 已卸载`)
}

// --- 加载一个扩展 ---
const loadOne = async entry => {
    const config = await import(pathToFileURL(entry.manifest).href).then(m => m.default || m)
    if (!config?.id) throw new Error('extension.js 必须导出 { id, ... }')

    const backendPath = config.backend || 'backend.js'
    const backendFile = join(entry.dir, backendPath)
    if (!await Bun.file(backendFile).exists()) throw new Error(`后端入口不存在：${backendPath}`)

    const { ctx, patches, ops, disposers } = createCtx(config.id)
    const backendModule = await import(pathToFileURL(backendFile).href)
    const init = backendModule.default
    if (typeof init !== 'function') throw new Error('backend.js 必须导出一个函数')

    await init(ctx)

    extensions.set(config.id, { dir: entry.dir, config, patches, ops, disposers, enabled: true })
    console.log(`[extensions] ${config.id} 已加载`)
    return config.id
}

// --- 加载全部扩展 ---
const load = async (ops) => {
    adminOps = ops   // 保存 Admin.OPS 引用，ctx.op 和 unload 都用这个
    const roots = [projectDir(), userDir()]
    resolverRoots.push(...roots)
    installResolver()

    const byName = new Map()
    for (const root of roots) for (const ext of await scan(root)) byName.set(ext.name, ext)

    const entries = []
    for (const ext of byName.values()) {
        try {
            const config = await import(pathToFileURL(ext.manifest).href).then(m => m.default || m)
            ext.config = config
            entries.push(ext)
        } catch (error) {
            failedList.push({ name: ext.name, error: error.message })
            console.error(`[extensions] ${ext.name} 声明文件读取失败：${error.message}`)
        }
    }

    let sorted = []
    try { sorted = sort(entries) }
    catch (error) { console.error(`[extensions] 依赖排序失败：${error.message}`) }

    const loaded = []
    for (const entry of sorted) {
        try { loaded.push(await loadOne(entry)) }
        catch (error) {
            failedList.push({ name: entry.name, error: error.message })
            console.error(`[extensions] ${entry.name} 加载失败：${error.message}`)
        }
    }
    if (loaded.length) console.log(`[extensions] 已加载：${loaded.join(', ')}`)

    if (process.env.NODE_ENV !== 'production') startWatch(roots)
    return { loaded, failed: failedList }
}

// --- 热更新 ---
const startWatch = roots => {
    for (const root of roots) {
        // fs.watch 返回 AsyncIterator，不是 Promise；用 for-await 遍历
        void (async () => {
            try {
                const w = watch(root, { recursive: true })
                for await (const event of w) {
                    const filename = event.filename
                    if (!filename) continue
                    const extName = filename.split(sep)[0]
                    if (!extName) continue
                    const ext = extensions.get(extName)
                    if (!ext) continue
                    console.log(`[extensions] 检测到 ${extName} 变化，正在重新加载…`)
                    try {
                        await unload(extName)
                        const entry = (await scan(root)).find(e => e.name === extName)
                        if (entry) {
                            entry.config = await import(pathToFileURL(entry.manifest).href).then(m => m.default || m)
                            await loadOne(entry)
                        }
                    } catch (error) { console.error(`[extensions] ${extName} 重新加载失败：${error.message}`) }
                }
            } catch { /* 目录不存在或被删除时正常退出 */ }
        })()
    }
}

// --- 前端打包 ---
const frontendCache = new Map()

const buildFrontend = async name => {
    const ext = extensions.get(name)
    if (!ext) throw new Error(`扩展 ${name} 未加载`)
    const frontendEntry = ext.config.frontend || 'frontend/index.js'
    const frontendPath = join(ext.dir, frontendEntry)
    if (!await Bun.file(frontendPath).exists()) return null

    const cached = frontendCache.get(name)
    const entryMtime = await Bun.file(frontendPath).lastModified
    if (cached && cached.timestamp === entryMtime) return cached.code

    if (!resolverRoots.includes(ext.dir)) resolverRoots.push(ext.dir)

    const result = await Bun.build({
        entrypoints: [frontendPath],
        format: 'esm',
        external: ['vue', /^@agent\//, /^@app\//],
        plugins: [vueSfcPlugin()],
    })
    if (!result.success) throw new Error(`前端打包失败：${result.logs.map(l => l.message || l).join('\n')}`)
    const code = await result.outputs[0].text()
    // 浏览器里没有 vue 和 @app/ 模块，把这两类 import 替换成从全局取
    const browserCode = code
        .replace(/import\s*\{([^}]+)\}\s*from\s*["']vue["'];?/g,
            (_, names) => `const { ${names.trim()} } = window.__agent_vue__;`)
        .replace(/import\s*\{([^}]+)\}\s*from\s*["']@app\/([^"']+)["'];?/g,
            (_, names, path) => `const { ${names.trim()} } = window.__agent_app__[${JSON.stringify(path)}] ?? {};`)
        .replace(/import\s+(\w+)\s*from\s*["']@app\/([^"']+)["'];?/g,
            (_, name, path) => `const ${name} = (window.__agent_app__[${JSON.stringify(path)}] ?? {}).default ?? window.__agent_app__[${JSON.stringify(path)}];`)
    frontendCache.set(name, { code: browserCode, timestamp: entryMtime })
    return browserCode
}

// --- Vue SFC 编译插件 ---
const vueSfcPlugin = () => {
    let compiler
    return {
        name: 'vue-sfc',
        async setup(build) {
            build.onLoad({ filter: /\.vue$/ }, async args => {
                if (!compiler) compiler = await import('@vue/compiler-sfc')
                const src = await Bun.file(args.path).text()
                const { parse, compileScript, compileTemplate, rewriteDefault } = compiler
                const { descriptor } = parse(src)
                const id = Math.random().toString(36).slice(2, 10)

                const script = compileScript(descriptor, { id })
                let code = rewriteDefault(script.content, '__sfc_main__')

                if (descriptor.template) {
                    const tpl = compileTemplate({
                        source: descriptor.template.content,
                        filename: args.path,
                        id,
                        compilerOptions: { mode: 'module' },
                    })
                    code += '\n' + tpl.code.replace(/^export\s+function\s+render/, 'function render')
                        + '\n__sfc_main__.render = render\n'
                }

                if (descriptor.styles?.length) {
                    for (const style of descriptor.styles) {
                        code += `\nif(!__sfc_main__.__styles)__sfc_main__.__styles=[]\n`
                        code += `__sfc_main__.__styles.push(${JSON.stringify({ content: style.content, scoped: style.scoped })})\n`
                    }
                }

                code += '\nexport default __sfc_main__\n'
                return { contents: code, loader: 'js' }
            })
        },
    }
}

// --- 状态查询 ---
const state = () => ({
    loaded: [...extensions.keys()],
    failed: failedList,
})

// --- 开关扩展 ---
const toggle = async name => {
    const ext = extensions.get(name)
    if (ext?.enabled) {
        for (const [otherName, other] of extensions) {
            if (other.config?.requires?.includes(name)) await toggle(otherName)
        }
        await unload(name)
    } else {
        const entry = [...await scan(projectDir()), ...await scan(userDir())].find(e => e.name === name)
        if (entry) {
            entry.config = await import(pathToFileURL(entry.manifest).href).then(m => m.default || m)
            await loadOne(entry)
        }
    }
    return { ok: true, name, enabled: extensions.has(name) }
}

export default { load, state, toggle, buildFrontend }
