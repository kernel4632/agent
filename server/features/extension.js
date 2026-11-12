/*
 * 扩展加载器：扫描扩展、按依赖顺序启动、记录每一处改动以便拔出、打包扩展前端。
 *
 * 扩展放在两处，同名时用户目录的覆盖项目里的：
 *   <项目根>/extensions/<名字>/manifest.json     跟项目一起发布
 *   ~/.agents/extensions/<名字>/manifest.json    用户自己装的，所有项目共用
 *
 * manifest.json 声明这个扩展的身份和入口：
 *   { name?, description?, version?, requires?: ['别的扩展文件夹名'], backend?, frontend? }
 * backend 默认 backend.js，导出一个函数，接收 ctx：
 *   export default ctx => {
 *       ctx.patch(Tool, 'build', original => async args => { ... })   // 给框架方法包一层
 *       ctx.op('skill.list', params => Skills.list(params))           // 挂一个 /admin 动作
 *       ctx.onDispose(() => clearInterval(timer))                     // 拔出时自己收尾
 *   }
 * 通过 ctx 做的改动都有记录，关闭扩展时逐条恢复；直接改写框架对象的扩展拔不干净。
 * 同一个方法被几个扩展包装时按加载顺序叠成一条链，拔掉中间一层，剩下的重新接起来。
 *
 * 用户关掉的扩展记在数据目录的 extensions.json。文件改动不自动重载，
 * 只记进 changed，由用户在界面上点「重载」，避免写代码时反复重启扩展。
 *
 * 调用示例：
 *   await Extension.load(Admin.OPS)                          // server.js 启动时调一次
 *   await Extension.toggle({ name: 'skill', enabled: false })
 *   await Extension.reload('skill')
 *   const code = await Extension.buildFrontend('skill')
 */

import { readdir, watch } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, sep } from 'node:path'
import { homedir } from 'node:os'
import Path from '../utils/path.js'
import fail from '../utils/fail.js'

const serverDir = fileURLToPath(new URL('../', import.meta.url))
const projectDir = () => join(dirname(serverDir), 'extensions')
const userDir = () => join(process.env.HOME || process.env.USERPROFILE || homedir(), '.agents', 'extensions')
const stateFile = () => join(Path.root(), 'extensions.json')

// --- 运行状态 ---
const found = new Map()       // 名字 → { name, dir, manifest, source, config, hasFrontend, error }
const loaded = new Map()      // 名字 → { patches, ops, disposers }，正在生效的扩展
const changed = new Set()     // 代码改过、还没重载的扩展
const cyclic = new Set()      // 卷进循环依赖的扩展
const chains = new WeakMap()  // 被包装的对象 → Map(方法名 → { base, layers: [{ owner, wrap }] })
const frontendCache = new Map()
let disabled = new Set()      // 用户关掉的扩展
let adminOps = null           // Admin.OPS，由 load() 传入；feature 层不 import commands 层
const resolverRoots = []

// --- 让扩展能用 @agent/ 和框架的依赖包；只管扩展目录里发起的 import ---
const inside = (file, root) => {
    const raw = file.startsWith('file://') ? fileURLToPath(file.replace(/\?.*$/, '')) : file
    return raw.toLowerCase().startsWith((root + sep).toLowerCase())
}
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

// --- 重新 import 前清掉这个扩展目录下的模块缓存，重载才能拿到子文件的新代码 ---
const forget = dir => {
    for (const key of Object.keys(require.cache)) if (inside(key, dir)) delete require.cache[key]
}
const fresh = file => import(`${pathToFileURL(file).href}?v=${Date.now()}`)

// --- 扫描一个目录：每个带 manifest.json 的子文件夹算一个扩展 ---
const scan = async (root, source) => {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    const list = []
    for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const dir = join(root, entry.name)
        const manifest = join(dir, 'manifest.json')
        if (await Bun.file(manifest).exists()) list.push({ name: entry.name, dir, manifest, source })
    }
    return list
}

// --- 读一个扩展的声明（manifest.json）；读不出来就记下错误，不影响别的扩展 ---
const describe = async entry => {
    try {
        entry.config = await Bun.file(entry.manifest).json()
        entry.error = ''
    } catch (error) {
        entry.config = {}
        entry.error = `manifest.json 读取失败：${error.message}`
    }
    entry.requires = Array.isArray(entry.config.requires) ? entry.config.requires.map(String) : []
    entry.hasFrontend = await Bun.file(join(entry.dir, entry.config.frontend || 'frontend/index.js')).exists()
    return entry
}

// --- 用户关掉的扩展名单 ---
const readDisabled = async () => {
    const file = Bun.file(stateFile())
    const data = await file.exists() ? await file.json().catch(() => ({})) : {}
    return new Set(Array.isArray(data.disabled) ? data.disabled.map(String) : [])
}
const saveDisabled = () => Bun.write(stateFile(), JSON.stringify({ disabled: [...disabled].sort() }, null, 2))

// --- 方法包装链：原方法在最底层，每个扩展的包装按加载顺序叠上去 ---
// 拔掉任意一层都从原方法重新叠一遍，所以中间那层拔掉后上下两层仍然接得上。
const rebuild = (obj, key, chain) => {
    let fn = chain.base
    for (const layer of chain.layers) fn = layer.wrap(fn)
    obj[key] = fn
}

const wrap = (owner, obj, key, wrapper) => {
    if (typeof obj?.[key] !== 'function') throw new Error(`ctx.patch: ${key} 不是一个方法`)
    if (!chains.has(obj)) chains.set(obj, new Map())
    const table = chains.get(obj)
    if (!table.has(key)) table.set(key, { base: obj[key], layers: [] })
    const chain = table.get(key)
    chain.layers.push({ owner, wrap: wrapper })
    rebuild(obj, key, chain)
}

const unwrap = (owner, obj, key) => {
    const chain = chains.get(obj)?.get(key)
    if (!chain) return
    chain.layers = chain.layers.filter(layer => layer.owner !== owner)
    rebuild(obj, key, chain)
    if (!chain.layers.length) chains.get(obj).delete(key)
}

// --- 给一个扩展的 ctx：每一处改动都记在 record 里 ---
const createCtx = (name, record) => ({
    name,
    patch(obj, key, wrapper) {
        wrap(name, obj, key, wrapper)
        record.patches.push({ obj, key })
    },
    op(opName, handler) {
        if (!adminOps) throw new Error('ctx.op() 在 load() 调用前不可用')
        if (adminOps[opName] && !record.ops.some(item => item.opName === opName)) {
            throw new Error(`op ${opName} 已经存在，扩展不能覆盖框架或别的扩展的动作`)
        }
        adminOps[opName] = handler
        record.ops.push({ opName })
    },
    onDispose(fn) { record.disposers.push(fn) },
})

// --- 停掉一个扩展：先让它自己收尾，再逆序恢复 op 和方法包装 ---
const stopOne = async name => {
    const record = loaded.get(name)
    if (!record) return
    loaded.delete(name)
    for (const fn of record.disposers.reverse()) {
        try { await fn() } catch (error) { console.error(`[extensions] ${name} 收尾失败：${error.message}`) }
    }
    for (const { opName } of record.ops) delete adminOps?.[opName]
    for (const { obj, key } of record.patches) unwrap(name, obj, key)
    frontendCache.delete(name)
    console.log(`[extensions] ${name} 已停用`)
}

// --- 启动一个扩展；中途出错就把已经做了的改动全部撤掉 ---
const startOne = async entry => {
    const record = { patches: [], ops: [], disposers: [] }
    loaded.set(entry.name, record)
    try {
        const backendFile = join(entry.dir, entry.config.backend || 'backend.js')
        if (await Bun.file(backendFile).exists()) {
            const init = (await fresh(backendFile)).default
            if (typeof init !== 'function') throw new Error('backend.js 必须导出一个函数')
            await init(createCtx(entry.name, record))
        }
        entry.error = ''
        console.log(`[extensions] ${entry.name} 已加载`)
    } catch (error) {
        await stopOne(entry.name)
        entry.error = `启动失败：${error.message}`
        console.error(`[extensions] ${entry.name} ${entry.error}`)
    }
}

// --- 依赖顺序：被依赖的排前面；卷进循环的记进 cyclic，全部不启动 ---
const order = () => {
    cyclic.clear()
    const sorted = []
    const state = new Map()   // 名字 → 'visiting' | 'done'
    const visit = (name, path) => {
        if (state.get(name) === 'done') return
        if (state.get(name) === 'visiting') {
            for (const item of path.slice(path.indexOf(name))) cyclic.add(item)
            return
        }
        state.set(name, 'visiting')
        for (const dep of found.get(name)?.requires || []) if (found.has(dep)) visit(dep, [...path, name])
        state.set(name, 'done')
        sorted.push(name)
    }
    for (const name of [...found.keys()].sort()) visit(name, [])
    return sorted
}

// --- 这个扩展现在为什么不能启动；能启动时返回空字符串 ---
const blocker = name => {
    const entry = found.get(name)
    if (cyclic.has(name)) return '和其他扩展循环依赖'
    const missing = entry.requires.filter(dep => !found.has(dep))
    if (missing.length) return `缺少依赖：${missing.join('、')}`
    const off = entry.requires.filter(dep => !loaded.has(dep))
    if (off.length) return `依赖的扩展未启用：${off.join('、')}`
    return ''
}

// --- 依赖它的扩展（含间接依赖），关闭或重载它时要一起停 ---
const dependents = name => {
    const result = new Set()
    const walk = target => {
        for (const entry of found.values()) {
            if (entry.requires.includes(target) && !result.has(entry.name)) {
                result.add(entry.name)
                walk(entry.name)
            }
        }
    }
    walk(name)
    return [...result]
}

// --- 按依赖顺序启动所有该启动、还没启动的扩展 ---
const startAll = async () => {
    for (const name of order()) {
        const entry = found.get(name)
        if (loaded.has(name) || disabled.has(name) || entry.config === undefined) continue
        if (entry.error?.startsWith('manifest.json')) continue   // 声明都读不出来，不启动
        if (blocker(name)) continue
        await startOne(entry)
    }
}

// --- 停掉一个扩展和所有依赖它的扩展；依赖方先停 ---
const stopWithDependents = async name => {
    const list = [name, ...dependents(name)]
    const ranked = order()
    list.sort((a, b) => ranked.indexOf(b) - ranked.indexOf(a))
    for (const item of list) await stopOne(item)
}

// --- 启动时加载全部扩展 ---
const load = async ops => {
    adminOps = ops
    const roots = [[projectDir(), 'project'], [userDir(), 'user']]
    for (const [root] of roots) if (!resolverRoots.includes(root)) resolverRoots.push(root)
    installResolver()
    disabled = await readDisabled()

    found.clear()
    for (const [root, source] of roots) {
        for (const entry of await scan(root, source)) found.set(entry.name, await describe(entry))   // 用户目录后扫，覆盖同名项目扩展
    }
    await startAll()
    if (loaded.size) console.log(`[extensions] 已加载：${[...loaded.keys()].join(', ')}`)
    setTimeout(() => startWatch(roots.map(([root]) => root)), 2000)  // 启动完成 2s 后再监听，避免启动期的读写操作进 changed
    return list()
}

// --- 文件变化只记下来，不自动重载；界面提示用户点「重载」 ---
let watching = false
const startWatch = roots => {
    if (watching) return
    watching = true
    for (const root of roots) {
        void (async () => {
            try {
                for await (const event of watch(root, { recursive: true })) {
                    const name = String(event.filename || '').split(/[\\/]/)[0]
                    if (!found.has(name)) continue
                    changed.add(name)
                    frontendCache.delete(name)
                }
            } catch { /* 目录不存在就不监听 */ }
        })()
    }
}

// --- 给设置页的扩展清单 ---
const list = () => {
    const extensions = [...found.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(entry => ({
            name: entry.name,
            title: String(entry.config.name || entry.name),
            description: String(entry.config.description || ''),
            version: String(entry.config.version || ''),
            source: entry.source,
            enabled: !disabled.has(entry.name),       // 用户的开关
            running: loaded.has(entry.name),          // 实际是否在生效
            requires: entry.requires,
            dependents: dependents(entry.name),
            hasFrontend: entry.hasFrontend,
            changed: changed.has(entry.name),
            error: entry.error || (!disabled.has(entry.name) && !loaded.has(entry.name) ? blocker(entry.name) : ''),
        }))
    return {
        extensions,
        loaded: [...loaded.keys()],
        changed: [...changed],
    }
}

const entryOf = name => {
    const entry = found.get(String(name || ''))
    if (!entry) throw fail(404, `extension not found: ${name}`)
    return entry
}

// --- 开关一个扩展；关闭时依赖它的扩展一起停，重新打开后它们也一起恢复 ---
const toggle = async ({ name, enabled } = {}) => {
    const entry = entryOf(name)
    if (typeof enabled !== 'boolean') throw fail(400, 'enabled must be a boolean')
    if (enabled) disabled.delete(entry.name)
    else disabled.add(entry.name)
    await saveDisabled()
    if (!enabled) await stopWithDependents(entry.name)
    else await startAll()
    return list()
}

// --- 重载一个扩展：停掉它和依赖它的扩展，重读代码后再按顺序启动 ---
const reload = async name => {
    const entry = entryOf(name)
    await stopWithDependents(entry.name)
    for (const item of [entry.name, ...dependents(entry.name)]) {
        await describe(found.get(item))
        changed.delete(item)
        frontendCache.delete(item)
    }
    await startAll()
    return list()
}

// --- 前端打包：只打包正在生效的扩展；vue 和 @app/ 留成外部引用，换成前端传入的变量 ---
const buildFrontend = async name => {
    const entry = entryOf(name)
    if (!loaded.has(entry.name) || !entry.hasFrontend) return null
    if (frontendCache.has(entry.name)) return frontendCache.get(entry.name)

    const result = await Bun.build({
        entrypoints: [join(entry.dir, entry.config.frontend || 'frontend/index.js')],
        format: 'esm',
        external: ['vue'],
        plugins: [
            {
                name: 'app-external',
                setup(build) {
                    build.onResolve({ filter: /^@app\// }, args => ({ path: args.path, external: true }))
                    build.onResolve({ filter: /^@agent\// }, args => ({ path: args.path, external: true }))
                },
            },
            vueSfcPlugin(),
        ],
    })
    if (!result.success) throw fail(500, `前端打包失败：${result.logs.map(log => log.message || String(log)).join('\n')}`)

    // import { a as b } 换成解构时要写成 { a: b }
    const destructure = (names, from) => `const { ${names.split(',').map(part => part.trim()).filter(Boolean)
        .map(part => part.replace(/^(\w+)\s+as\s+(\w+)$/, '$1: $2')).join(', ')} } = ${from};`
    const code = (await result.outputs[0].text())
        .replace(/import\s*\{([^}]+)\}\s*from\s*["']vue["'];?/g, (_, names) => destructure(names, '__agentVue__'))
        .replace(/import\s*\{([^}]+)\}\s*from\s*["']@app\/([^"']+)["'];?/g,
            (_, names, path) => destructure(names, `(__agentApp__[${JSON.stringify(path)}] ?? {})`))
        .replace(/import\s+(\w+)\s*from\s*["']@app\/([^"']+)["'];?/g,
            (_, local, path) => `const ${local} = __agentApp__[${JSON.stringify(path)}];`)
    frontendCache.set(entry.name, code)
    return code
}

// --- .vue 编译插件：脚本和模板一起编译，样式编译后在组件模块加载时插进 <head> ---
const vueSfcPlugin = () => ({
    name: 'vue-sfc',
    setup(build) {
        build.onLoad({ filter: /\.vue$/ }, async args => {
            const { parse, compileScript, compileTemplate, compileStyle, rewriteDefault } = await import('@vue/compiler-sfc')
            const { descriptor } = parse(await Bun.file(args.path).text(), { filename: args.path })
            const id = Bun.hash(args.path).toString(36).slice(0, 8)   // 同一文件每次打包 id 不变
            const scopeId = `data-v-${id}`
            const scoped = descriptor.styles.some(style => style.scoped)

            let code
            if (descriptor.script || descriptor.scriptSetup) {
                const script = compileScript(descriptor, {
                    id,
                    inlineTemplate: true,
                    templateOptions: { scoped, compilerOptions: { scopeId: scoped ? scopeId : undefined } },
                })
                code = rewriteDefault(script.content, '__sfc_main__')
            } else {
                const tpl = compileTemplate({ source: descriptor.template?.content || '', filename: args.path, id, scoped })
                code = tpl.code.replace(/^export\s+function\s+render/m, 'function render') + '\nconst __sfc_main__ = { render }\n'
            }
            if (scoped) code += `\n__sfc_main__.__scopeId = ${JSON.stringify(scopeId)}\n`

            let css = ''
            for (const style of descriptor.styles) {
                const source = style.src ? await Bun.file(join(dirname(args.path), style.src)).text() : style.content
                css += compileStyle({ source, filename: args.path, id: scopeId, scoped: style.scoped }).code + '\n'
            }
            if (css) {
                code += `\n;(() => { if (typeof document === 'undefined') return; document.querySelector('style[data-extension-style="${id}"]')?.remove(); const el = document.createElement('style'); el.dataset.extensionStyle = ${JSON.stringify(id)}; el.textContent = ${JSON.stringify(css)}; document.head.appendChild(el) })()\n`
            }
            return { contents: code + '\nexport default __sfc_main__\n', loader: 'js' }
        })
    },
})

export default { load, list, toggle, reload, buildFrontend }
