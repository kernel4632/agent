/*
 * 配置指令：读取本机配置文件、替换配置、保存配置、试一次模型请求。
 *
 * 配置里既有模型服务信息，也有工具权限规则 permission，所以本文件同时管着这两件事。
 * 调用示例：
 *   await Config.read(Path.config())            // 启动时读一次
 *   Config.get().providers                      // 取当前模型服务列表
 *   Config.get().permission                     // 取工具权限规则
 *   Config.resolve({ provider: 'default', model: 'gpt-4o' })  // 取某套模型服务给 Agent 用的配置
 *   await Config.test({ provider: 'default', model: 'gpt-4o' })  // 真实请求一次，确认能用
 *   await Config.set({ providers: [], permission: { '*': 'ask' } })  // 整体替换并保存
 *   await Config.save(Path.config())            // 只保存当前配置
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import Agent from '@kernel4632/agent-core'
import Path from '../utils/path.js' // 提供默认配置文件路径。
import Store from '../store.js' // 直接访问程序当前使用的配置。
import fail from '../utils/fail.js' // 供应商不存在等业务错误带上状态码。

// 后端自己的版本号写在 package.json 里，服务状态接口把它报给前端。
import { version as packageVersion } from '../package.json' with { type: 'json' }

// --- 读取配置 ---
const read = async path => {
    // 第一次启动时配置文件还不存在，从空对象开始。
    const file = Bun.file(path)
    const config = await file.exists() ? await file.json() : {}
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Object.assign(Store.config, config)
    return config
}

// --- 替换配置 ---
const set = async newConfig => {
    // 用户提交的配置必须是对象，否则挑一个字段来覆盖是无意义的。
    if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
        throw new TypeError('config must be an object')
    }

    // 整体替换，不偷偷合并旧字段，保证用户提交的配置就是实际配置。
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Object.assign(Store.config, structuredClone(newConfig))
    return save(Path.config())
}

// --- 读取当前配置 ---
const get = () => Store.config

// --- 找出配置里第一个能用的模型 ---
const firstModel = () => {
    // 用户没有指定模型时，用第一个启用的服务商和它的第一个模型。
    const provider = (Store.config.providers || []).find(item => item.enabled !== false)
    const model = provider?.models?.[0]
    return {
        provider: provider?.name || '',
        model: typeof model === 'string' ? model : model?.id || '',
    }
}

// --- 把配置转换成 Agent 能用的形状 ---
const resolve = ({ provider: name, model }) => {
    // 设置页里字段名和 Agent 要的字段名不一样；转换只写在这一处，界面改字段名也只改这里。
    const provider = (Store.config.providers || []).find(item => item.name === name)
    if (!provider) throw fail(400, `Provider not found: ${name}`)

    let headers = provider.headers || {}
    if (typeof headers === 'string') headers = JSON.parse(headers || '{}') // 设置页把请求头写成 JSON 文本。
    const settings = provider.modelSettings?.[model] || {}
    return {
        baseURL: provider.baseURL || '',
        apiKey: provider.apiKey || provider.key || '',
        model,
        protocol: provider.protocol === 'openai-compatible' ? 'chat' : provider.protocol || 'chat',
        maxTokens: settings.context || settings.contextWindow || 128000, // 上下文预算，到达 80% 时自动压缩
        stream: provider.stream ?? Store.config.stream ?? true,
        system: Store.config.prompt?.system || '',
        provider: { headers, body: provider.body || {} }, // 请求头和额外请求体原样交给底层模型请求
    }
}

// --- 真实试一次模型请求 ---
const test = async ({ provider: name, model }) => {
    // 用户点名了供应商就查它；没点名才回退到配置里第一个能用的。
    if (name) {
        const provider = (Store.config.providers || []).find(item => item.name === name)
        // 名字写错时说清是哪个名字不存在，否则用户会以为自己压根没配过供应商。
        if (!provider) throw fail(400, `Provider not found: ${name}`)
        const first = provider.models?.[0]
        const chosen = model || (typeof first === 'string' ? first : first?.id)
        if (!chosen) throw fail(400, `Provider has no model to test: ${name}`)
        return attempt({ provider: name, model: chosen })
    }

    const chosen = firstModel()
    if (!chosen.provider || !chosen.model) throw fail(400, 'no provider or model configured to test')
    return attempt(chosen)
}

// --- 发一次最小的真实请求 ---
const attempt = async chosen => {
    // 用最小的真实请求验证这一整套配置：地址对不对、密钥能不能用、模型名存不存在。
    const result = await Agent.llm.chat({
        ...resolve(chosen),
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
    })
    return { ok: true, provider: chosen.provider, model: chosen.model, text: result.text }
}

// --- 读取后端版本 ---
const version = () => packageVersion

// --- 保存配置 ---
const save = async path => {
    await mkdir(dirname(path), { recursive: true })
    // 先写临时文件，再替换正式文件，避免程序中断留下半份 JSON。
    await writeFile(path, JSON.stringify(Store.config, null, 2))
    return Store.config
}

export default { read, set, get, firstModel, resolve, test, version, save }
