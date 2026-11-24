/*
扩展前端的开发加载器（仅 dev 模式，vite 下才有效）：
?ext=a,b 时把列出的扩展换成直接 import extensions/<名字>/frontend/index.js 源码，
进 vite 模块图后有 HMR 和完整的 Volar 推导；后端照常跑，只有这些扩展的前端不走后端打包产物。
生产构建 main.ts 走 dev-extensions.prod.ts 的空实现（import.meta.env.PROD 分支），扩展源码不进产物。
*/

import { Extension, Loaded, Panels, Settings } from './Extension'

export async function loadDevExtensions(dev: string[], shared: Record<string, unknown>) {
    shared.Panels = Panels
    shared.Settings = Settings
    // import.meta.glob：vite 静态扫出每个内置扩展的前端入口，键是相对于本文件的路径。
    const sources = import.meta.glob<{ default: (app: any) => unknown }>('../../extensions/*/frontend/index.js')
    for (const name of dev) {
        const source = sources[`../../extensions/${name}/frontend/index.js`]
        if (source) await Extension.run(name, shared, source)
        else Loaded.push({ name, patched: [], error: `没有 ${name} 的前端入口（开发模式只认内置扩展）` })
    }
}
