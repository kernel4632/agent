/*
把扩展的 frontend/index.js 打成一棵 ESM，按 frontend/ 下所有文件里最新的 mtime 缓存（改 .vue 也会重打）。
vue 留成外部引用，运行时由网页换成自己的 Vue；.vue 用 compiler-sfc 编进同一个文件。
扩展目录旁边没有 node_modules 时，裸包名（如 @hugeicons/core-free-icons）退回到后端自己的依赖里找。
*/

import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const cache = new Map()

// 整个 frontend/ 目录里最新的修改时间；子目录一起算。
async function mtime(folder) {
    let latest = 0
    const entries = await readdir(folder, { withFileTypes: true, recursive: true }).catch(() => [])
    for (const entry of entries) {
        if (!entry.isFile()) continue
        try { latest = Math.max(latest, (await stat(join(entry.parentPath ?? entry.path, entry.name))).mtimeMs) } catch { /* 刚被删掉 */ }
    }
    return latest
}

function fallbackPlugin() {
    return {
        name: 'host-modules',
        setup(build) {
            build.onResolve({ filter: /^(?!vue$)[@a-z]/ }, args => {
                try { return { path: Bun.resolveSync(args.path, args.resolveDir) } } catch { /* 扩展自己没装 */ }
                try { return { path: Bun.resolveSync(args.path, import.meta.dir) } } catch { return undefined }
            })
        },
    }
}

function vuePlugin() {
    return {
        name: 'vue-sfc',
        setup(build) {
            build.onLoad({ filter: /\.vue$/ }, async args => {
                const { parse, compileScript, compileTemplate, compileStyle, rewriteDefault } = await import('@vue/compiler-sfc')
                const { descriptor } = parse(await Bun.file(args.path).text(), { filename: args.path })
                const id = Bun.hash(args.path).toString(36).slice(0, 8)
                const scopeId = `data-v-${id}`
                const scoped = descriptor.styles.some(style => style.scoped)
                let code
                if (descriptor.script || descriptor.scriptSetup) {
                    const script = compileScript(descriptor, { id, inlineTemplate: true, templateOptions: { scoped, compilerOptions: { scopeId: scoped ? scopeId : undefined } } })
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
                    code += `\n;(() => { if (typeof document === 'undefined') return; const el = document.createElement('style'); el.textContent = ${JSON.stringify(css)}; document.head.appendChild(el) })()\n`
                }
                return { contents: code + '\nexport default __sfc_main__\n', loader: 'js' }
            })
        },
    }
}

function rewrite(code) {
    const destructure = (names, from) => `const { ${names.split(',').map(part => part.trim()).filter(Boolean).map(part => part.replace(/^(\w+)\s+as\s+(\w+)$/, '$1: $2')).join(', ')} } = ${from};`
    return code
        .replace(/import\s*\{([^}]+)\}\s*from\s*["']vue["'];?/g, (_, names) => destructure(names, '__agentVue__'))
        .replace(/import\s*\*\s*as\s*(\w+)\s*from\s*["']vue["'];?/g, (_, local) => `const ${local} = __agentVue__;`)
        .replace(/import\s+(\w+)\s*from\s*["']vue["'];?/g, (_, local) => `const ${local} = __agentVue__.default ?? __agentVue__;`)
}

export const Bundle = {
    forget(name) { cache.delete(name) },

    async pack(name, folder) {
        const entry = join(folder, 'frontend/index.js')
        const stamp = await mtime(join(folder, 'frontend'))
        const hit = cache.get(name)
        if (hit && hit.stamp === stamp) return hit.code
        const result = await Bun.build({ entrypoints: [entry], format: 'esm', external: ['vue'], plugins: [vuePlugin(), fallbackPlugin()] })
        if (!result.success) throw new Error(`前端打包失败（${name}）：${result.logs.map(log => log.message || String(log)).join('\n')}`)
        const code = rewrite(await result.outputs[0].text())
        cache.set(name, { stamp, code })
        return code
    },
}
