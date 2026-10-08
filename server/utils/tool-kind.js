/*
 * 工具分类：一次工具调用属于哪一类。
 *
 * 分类只写在这里一处，两个地方都从这里读：
 *   - 自动批准按类别分别开关（读取 / 写入 / 命令 / MCP），和 roo code 的分类对齐
 *   - plan 模式按类别去掉能改磁盘的工具
 * 加一个内置工具只改这张表，不用去别的地方同步。
 * 调用示例：
 *   Kind.of({ toolName: 'file_write' })                             // 'write'
 *   Kind.of({ toolName: 'everything_echo', mcpServers: ['everything'] })  // 'mcp'
 *   Kind.of({ toolName: '我的脚本' })                                // 'other'，未分类
 *   Kind.writing(Object.keys(agent.tools.schema))                   // 能改磁盘的那些工具名
 */

/*
 * 自动批准按这四类分别开关。
 * 没有 other：未分类的工具不提供"自动批准"这个选项，一律要问——
 * 不能因为"不知道它是什么"就替用户决定放行。
 */
export const KINDS = ['read', 'write', 'command', 'mcp']

// 能改磁盘的种类：写工具直接改，命令通过重定向、rm 这些也能改。
// plan 模式去掉这两类，剩下的是"只能看"的。
const WRITING = ['write', 'command']

// 内置工具的分类。加一个内置工具就在这里加一行。
const BUILT_IN = {
    file_read: 'read',
    file_list: 'read',
    glob: 'read',
    grep: 'read',
    webfetch: 'read',
    skill: 'read',
    file_write: 'write',
    edit: 'write',
    apply_patch: 'write',
    shell: 'command',
    // 下面这些既不改磁盘也不碰外部服务，不参与自动批准，在 plan 模式里照常可用。
    todo: 'other',
    task: 'other',
    finish: 'other',
    ask: 'other',
}

/**
 * 这个工具属于哪一类。
 *
 * MCP 的工具名带"服务名_"前缀，所以要用配置里的服务名认一遍——
 * 光看名字没法区分 `everything_echo` 是 MCP 服务给的还是用户自己写的工具。
 * @param {{ toolName: string, mcpServers?: string[] }} call 工具名，以及当前配置里有哪些 MCP 服务。
 * @returns {'read'|'write'|'command'|'mcp'|'other'} 认不出来的一律是 other。
 */
const of = ({ toolName, mcpServers = [] }) => {
    if (mcpServers.some(name => toolName.startsWith(`${name}_`))) return 'mcp'
    return BUILT_IN[toolName] || 'other'
}

/**
 * 这些工具里，哪些能改磁盘。
 * @param {string[]} names 工具名。
 * @returns {string[]} 能改磁盘的工具名；plan 模式用这个名单去调 Agent.tool.omit。
 */
const writing = names => names.filter(name => WRITING.includes(of({ toolName: name })))

/*
 * 这张表原样导出去，只是为了让契约测试能查"是不是每个内置工具都写进来了、有没有留下已删的名"。
 * 业务代码不该读它，要用就用 of()。
 */
export const TABLE = BUILT_IN

export default { of, writing, KINDS }
