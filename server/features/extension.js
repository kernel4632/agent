/*
 * 扩展加载器：启动时把每个扩展的 backend.js import 一遍，扩展在 import 时直接改写框架模块的导出方法。
 *
 * 框架不给扩展预留口子：扩展 import 框架模块，把导出对象上的方法包一层（先调原方法，再加自己的东西）。
 * 几个扩展包同一个方法时层层叠加，只要每层都调用原方法就互不覆盖。
 *
 * 扩展放在两处，同名时用户目录的覆盖项目里的：
 *   <项目根>/extensions/<名字>/backend.js      跟项目一起发布
 *   ~/.agents/extensions/<名字>/backend.js     用户自己装的，所有项目共用
 *
 * 扩展里怎么引用框架和依赖：
 *   import Tool from '@agent/features/tool.js'   // @agent/ 指向 server/，扩展放在哪都能用
 *   import matter from 'gray-matter'              // 先找扩展自己的 node_modules，找不到再用 server/ 的
 * 两种写法拿到的都是和框架同一份模块实例，改写的方法框架里立刻生效。
 *
 * 调用示例：
 *   await Extension.load()   // server.js 启动时、开始服务之前调一次
 */

import { readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, sep } from 'node:path'
import { homedir } from 'node:os'

const serverDir = fileURLToPath(new URL('../', import.meta.url))          // server/
const projectDir = () => join(dirname(serverDir), 'extensions')            // <项目根>/extensions
const userDir = () => join(process.env.HOME || process.env.USERPROFILE || homedir(), '.agents', 'extensions')

// --- 让扩展能用 @agent/ 和框架的依赖包 ---
// 只管扩展目录里的文件发起的 import，框架自己的 import 原样交给 Bun 默认解析。
const inside = (file, root) => file.toLowerCase().startsWith((root + sep).toLowerCase())
let resolverReady = false
const installResolver = roots => {
    if (resolverReady) return
    resolverReady = true
    Bun.plugin({
        name: 'agent-extensions',
        setup(build) {
            // @agent/xxx → server/xxx
            build.onResolve({ filter: /^@agent\// }, args => ({ path: join(serverDir, args.path.slice('@agent/'.length)) }))
            // 裸包名：扩展自己装了就用自己的，没装就借用 server/ 的
            build.onResolve({ filter: /^[^./\\]/ }, args => {
                if (args.path.includes(':') || !args.importer) return undefined           // node:fs 这类内置模块不管
                if (!roots.some(root => inside(args.importer, root))) return undefined     // 不是扩展发起的不管
                try { return { path: Bun.resolveSync(args.path, dirname(args.importer)) } } catch {}
                try { return { path: Bun.resolveSync(args.path, serverDir) } } catch {}
                return undefined                                                           // 都找不到，交给默认解析报错
            })
        },
    })
}

// --- 列出一个目录下的扩展：每个子文件夹里有 backend.js 的算一个 ---
const scan = async root => {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])   // 目录不存在就是没有扩展
    const found = []
    for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const backend = join(root, entry.name, 'backend.js')
        if (await Bun.file(backend).exists()) found.push({ name: entry.name, backend })
    }
    return found
}

// --- 加载全部扩展；一个扩展坏了只跳过它自己，不拖垮启动 ---
const load = async () => {
    const roots = [projectDir(), userDir()]
    installResolver(roots)
    const byName = new Map()
    for (const root of roots) for (const ext of await scan(root)) byName.set(ext.name, ext)   // 后扫的用户目录覆盖同名项目扩展

    const loaded = []
    const failed = []
    for (const ext of byName.values()) {
        try {
            await import(pathToFileURL(ext.backend).href)          // 副作用：扩展在这里改写框架方法
            loaded.push(ext.name)
        } catch (error) {
            failed.push({ name: ext.name, error: error.message })
            console.error(`[extensions] ${ext.name} 加载失败：${error.message}`)
        }
    }
    if (loaded.length) console.log(`[extensions] 已加载：${loaded.join(', ')}`)
    return { loaded, failed }
}

export default { load, state: () => state }
