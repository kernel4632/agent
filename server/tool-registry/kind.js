/*
 * 工具分类：一次工具调用属于哪一类。
 *
 * 分类由每个工具文件自己声明（kind 字段），扫描时登记到这里；
 * 自动批准和 plan 模式只读这张运行时表，不再维护第二份工具名单。
 * 调用示例：
 *   Kind.register({ name: 'read_file', kind: 'read' })
 *   Kind.of({ toolName: 'read_file' })                                // 'read'
 *   Kind.of({ toolName: 'everything_echo', mcpServers: ['everything'] }) // 'mcp'
 *   Kind.writing(['read_file', 'write_to_file'])                      // ['write_to_file']
 */

import { canonical } from './names.js' // 旧工具名也要能分到同一类。

/*
 * 自动批准能分别开关的类别。这份清单和 roo code 的设置面板对齐：
 * 它给用户的开关是「读取 / 写入 / 执行命令 / 使用 MCP / 切换模式 / 创建子任务 / 追问」。
 * 我们没有"切换模式"这个工具（模式是用户在界面上切的，不是模型自己切的），
 * 也没有"追问"那个自动选答案的机制（它是界面行为，不是工具审批），所以这两项不在这里。
 *
 * 每一项的 label 和 hint 是给界面直接用的，界面不用自己再抄一份。
 */
export const KINDS = [
    { kind: 'read', label: '读取', hint: '读文件、列目录、搜代码、抓网页' },
    { kind: 'write', label: '写入', hint: '改文件、打补丁' },
    { kind: 'command', label: '执行命令', hint: '跑命令' },
    { kind: 'mcp', label: '使用 MCP', hint: 'MCP 服务提供的工具' },
    { kind: 'subtask', label: '创建子任务', hint: '开一个子任务去干活' },
]

// 能改磁盘的种类：写工具直接改，命令通过重定向、rm 这些也能改。
// plan 模式去掉这两类，剩下的就是"只能看"的。
const WRITING = ['write', 'command']

// 工具文件在扫描时把自己的类别登记进来；没有登记的工具按 'other' 处理。
const registry = new Map()

// --- 登记一个工具 ---
const register = ({ name, kind }) => {
    if (!name || !kind) return
    registry.set(canonical(name), kind)
}

// --- 测试和工具目录用：看当前登记了哪些工具 ---
const registered = () => new Map(registry)

/**
 * 这个工具属于哪一类。
 *
 * MCP 的工具名带"服务名_"前缀，所以要用配置里的服务名认一遍——
 * 光看名字没法区分 `everything_echo` 是 MCP 服务给的还是用户自己写的工具。
 * @param {{ toolName: string, mcpServers?: string[] }} call 工具名，以及当前配置里有哪些 MCP 服务。
 * @returns {string} 类别名；认不出来的一律是 'other'，'never' 表示不需要批准。
 */
const of = ({ toolName, mcpServers = [] }) => {
    if (mcpServers.some(name => toolName.startsWith(`${name}_`))) return 'mcp'
    return registry.get(canonical(toolName)) || 'other'
}

/**
 * 这些工具里，哪些能改磁盘。
 * @param {string[]} names 工具名。
 * @returns {string[]} 能改磁盘的工具名；plan 模式用这个名单去调 Agent.tool.omit。
 */
const writing = names => names.filter(name => WRITING.includes(of({ toolName: name })))

// --- 测试和扫描器用：清空运行时登记，工具目录重新扫描 ---
const reset = () => registry.clear()

export default { of, writing, KINDS, register, registered, reset }
