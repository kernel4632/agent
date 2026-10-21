/*
 * 工具目录：设置页画权限开关时要知道"一共有哪些工具"。
 *
 * 内置工具的名字来自 utils/tool-kind.js 的分类表，用户自己写的工具靠在数据目录里扫一遍。
 * MCP 工具要连上服务才知道名字，这里不连；它们统一由自动批准里的 `mcp` 类别管。
 * 调用示例：
 *   await Tools.list()   // [{ name: 'read_file', kind: 'read', permission: 'ask' }, ...]
 */

import { mkdir } from 'node:fs/promises'
import Agent from '@kernel4632/agent-core'
import Path from '../utils/path.js'
import Store from '../store.js'
import { TABLE } from '../utils/tool-kind.js'
import { canonical, previousNames } from '../utils/tool-names.js' // 旧 permission 配置继续生效。

/**
 * 这个工具当前生效的权限动作。
 * 工具自己的规则优先；对象规则看默认项；都没写就跟随全局 `*`。
 * @param {string} name 工具名。
 * @returns {'allow'|'ask'|'deny'} 当前动作。
 */
const permissionOf = name => {
    const rules = Store.config.permission || {}
    // 新名字优先，旧名字兜底，改名不会让用户原来的 deny 规则失效。
    const rule = [canonical(name), ...previousNames(name)].map(item => rules[item]).find(item => item !== undefined)
    if (typeof rule === 'string') return rule === 'allow' ? 'allow' : rule === 'deny' ? 'deny' : 'ask'
    if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
        return typeof rule['*'] === 'string' ? rule['*'] : 'ask'
    }
    return rules['*'] === 'allow' ? 'allow' : 'ask'
}

/**
 * 列出内置工具和用户工具。
 * @returns {Promise<Array<{ name: string, kind: string, permission: string }>>} 按名字排序的工具目录。
 */
const list = async () => {
    // 首次运行还没建用户工具目录时先建出来，扫描空目录不报错。
    await mkdir(Path.tools(), { recursive: true })
    // 只扫内置目录和用户工具目录；不碰 MCP，避免设置页打开时去起外部进程。
    const scanned = await Agent.tool.from(new URL('../tools/', import.meta.url), Path.tools())
    const names = new Set([...Object.keys(TABLE), ...Object.keys(scanned.schema)])
    return [...names]
        // 记清单 / 结束循环这些控制工具没有"要不要批准"这回事，不放进设置页。
        .filter(name => TABLE[name] !== 'never')
        .sort()
        .map(name => ({ name, kind: TABLE[name] || 'other', permission: permissionOf(name) }))
}

export default { list }
