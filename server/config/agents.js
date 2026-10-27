/*
 * 智能体定义：内置角色和用户自定义角色都在这里归一化。
 *
 * 一个智能体只回答四件事：
 *   - 它是谁：名称、说明、额外提示词；
 *   - 它能做什么：只读开关和工具白名单；
 *   - 它用哪个模型：可选；不写就沿用会话当前模型；
 *   - 它的权限边界：可选的 permission 覆盖，写法与全局 permission 相同。
 *
 * 配置里的键叫 agents；旧版本写 modes 的配置在 Config 读取时自动迁移。
 * 内置智能体也可以被同名条目覆盖，但名字不能重复。
 * 调用示例：
 *   Agents.list(Config.get())          // 完整清单，包含内置和自定义
 *   Agents.get(Config.get(), 'plan')   // 单个定义；不认识时是 null
 */

// 名字会写进 settings.json 和规则目录名，只收安全字符。
const SAFE_NAME = /^[a-zA-Z0-9_-]+$/
const ACTIONS = new Set(['allow', 'ask', 'deny'])

/*
 * 内置智能体。
 * build / plan 保持原来的行为：plan 靠去掉写工具实现只读，不靠提示词祈祷。
 * ask 和 debug 是通用化的新角色，名字不绑定任何产品。
 */
const BUILTIN = [
    {
        name: 'build',
        label: '执行',
        description: '可以改文件、执行命令',
        instructions: '',
        readOnly: false,
        tools: null,
        model: null,
        permission: null,
    },
    {
        name: 'plan',
        label: '计划',
        description: '只读工具，先看清再动手',
        instructions: '',
        readOnly: true,
        tools: null,
        model: null,
        permission: null,
    },
    {
        name: 'ask',
        label: '问答',
        description: '只回答和解释，不碰文件',
        instructions: '你只回答问题和解释代码，不修改文件。回答要直接，必要时指出相关文件路径。',
        readOnly: true,
        tools: ['read_file', 'list_files', 'search_files', 'glob', 'webfetch', 'skill', 'ask_followup_question', 'attempt_completion'],
        model: null,
        permission: null,
    },
    {
        name: 'debug',
        label: '调试',
        description: '复现、定位、最小修复',
        instructions: '先复现问题，再定位原因，最后做最小修复。改完运行相关测试，并把结果说清楚。',
        readOnly: false,
        tools: null,
        model: null,
        permission: null,
    },
]

const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

const cleanText = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback

/**
 * 只保留合法的工具名；null 表示不点名，沿用全部工具。
 * @param {unknown} value 配置里的 tools。
 * @returns {string[]|null} 去重后的名单或 null。
 */
const normalizeTools = value => {
    if (!Array.isArray(value)) return null
    return [...new Set(value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))]
}

/**
 * 模型覆盖只认同时写了供应商和模型名的对象，缺一半按没配处理。
 * @param {unknown} value 配置里的 model。
 * @returns {{ provider: string, model: string }|null} 规范化的模型或 null。
 */
const normalizeModel = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const provider = cleanText(value.provider)
    const model = cleanText(value.model)
    return provider && model ? { provider, model } : null
}

/**
 * 权限覆盖和全局 permission 同形：字符串动作，或按参数模式展开的对象。
 * 写错的动作丢掉，不能让一个拼错的词变成放行。
 * @param {unknown} value 配置里的 permission。
 * @returns {object|null} 规范化后的规则或 null。
 */
const normalizePermission = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const rules = {}
    for (const [name, rule] of Object.entries(value)) {
        if (typeof rule === 'string') {
            if (ACTIONS.has(rule)) rules[name] = rule
            continue
        }
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue
        const nested = {}
        for (const [pattern, action] of Object.entries(rule)) {
            if (typeof action === 'string' && ACTIONS.has(action)) nested[pattern] = action
        }
        if (Object.keys(nested).length) rules[name] = nested
    }
    return Object.keys(rules).length ? rules : null
}

/**
 * 把一条自定义定义叠到基础定义上。
 * 只有真的写了某个字段才覆盖；写 null 表示清空内置的模型或权限。
 * @param {object} value 配置里的原始定义。
 * @param {object} base 内置或空白基础定义。
 * @returns {object} 完整定义。
 */
const merge = (value, base) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base
    return {
        ...base,
        label: cleanText(value.label, base.label) || base.label,
        description: cleanText(value.description, base.description),
        instructions: typeof value.instructions === 'string' ? value.instructions : base.instructions,
        readOnly: typeof value.readOnly === 'boolean' ? value.readOnly : base.readOnly,
        tools: has(value, 'tools') ? normalizeTools(value.tools) : base.tools,
        model: has(value, 'model') ? normalizeModel(value.model) : base.model,
        permission: has(value, 'permission') ? normalizePermission(value.permission) : base.permission,
    }
}

const definitions = config => {
    const value = config?.agents
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * 当前可用的全部智能体。
 * @param {object} config 全局配置。
 * @returns {Array<{ name: string, label: string, description: string, instructions: string, readOnly: boolean, tools: string[]|null, model: object|null, permission: object|null, builtin: boolean }>}
 */
const list = config => {
    const custom = definitions(config)
    const result = BUILTIN.map(base => ({
        ...merge(custom[base.name], base),
        name: base.name,
        builtin: true,
    }))
    for (const [name, value] of Object.entries(custom)) {
        if (!SAFE_NAME.test(name)) continue
        if (BUILTIN.some(base => base.name === name)) continue
        result.push({
            ...merge(value, {
                label: name,
                description: '',
                instructions: '',
                readOnly: false,
                tools: null,
                model: null,
                permission: null,
            }),
            name,
            builtin: false,
        })
    }
    return result
}

/**
 * 按名字取一个智能体。
 * @param {object} config 全局配置。
 * @param {string} name 智能体名。
 * @returns {object|null} 定义；不认识时是 null。
 */
const get = (config, name) => list(config).find(item => item.name === name) || null

const names = config => list(config).map(item => item.name)

export default { BUILTIN, SAFE_NAME, list, get, names }
