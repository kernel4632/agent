/*
 * 工具分类：一次工具调用属于哪一类。
 *
 * 分类只写在这里一处，两个地方都从这里读：
 *   - 自动批准按类别分别开关
 *   - plan 模式按类别去掉能改磁盘的工具
 * 加一个内置工具只改这张表，不用去别处同步。
 * 调用示例：
 *   Kind.of({ toolName: 'file_write' })                                   // 'write'
 *   Kind.of({ toolName: 'everything_echo', mcpServers: ['everything'] })  // 'mcp'
 *   Kind.of({ toolName: '我的脚本' })                                      // 'other'，没分类
 *   Kind.writing(Object.keys(agent.tools.schema))                         // 能改磁盘的那些工具名
 */

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

/*
 * 内置工具的分类。加一个内置工具就在这里加一行。
 * 契约测试会盯着：tools/ 里有的工具，这里必须有一行。
 */
const BUILT_IN = {
    // 看和查
    file_read: 'read',
    file_list: 'read',
    glob: 'read',
    grep: 'read',
    webfetch: 'read',
    skill: 'read',
    // 改
    file_write: 'write',
    edit: 'write',
    apply_patch: 'write',
    // 跑
    shell: 'command',
    // 开子任务
    task: 'subtask',
    /*
     * never：这几件是控制循环用的，既不碰磁盘也不碰外部服务，
     * 本来就没有"要不要批准"这回事。记清单和结束循环每次都要问一遍的话，
     * 用户只会一直点同意，审批弹窗也就没意义了。
     */
    todo: 'never',
    finish: 'never',
    ask: 'never',
}

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
    return BUILT_IN[toolName] || 'other'
}

/**
 * 这些工具里，哪些能改磁盘。
 * @param {string[]} names 工具名。
 * @returns {string[]} 能改磁盘的工具名；plan 模式用这个名单去调 Agent.tool.omit。
 */
const writing = names => names.filter(name => WRITING.includes(of({ toolName: name })))

/*
 * 分类表原样导出去，只是为了让契约测试能查"是不是每个内置工具都写进来了、有没有留下已删的名"。
 * 业务代码不该读它，要用就用 of()。
 */
export const TABLE = BUILT_IN

export default { of, writing, KINDS }
