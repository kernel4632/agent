/*
 * 一次工具调用会碰到哪些文件。
 *
 * 忽略规则要按这个名单判断"能不能碰"，文件快照要按这个名单决定"备份哪些"，
 * 所以它只写在这里一处。加一个新的文件工具，改这一个文件就够，测试会提醒你没忘。
 * 调用示例：
 *   toolFiles({ toolName: 'file_write', input: { path: 'a.txt' } })          // ['a.txt']
 *   toolFiles({ toolName: 'apply_patch', input: { patches: [{ path: 'a.js' }] } })  // ['a.js']
 *   toolFiles({ toolName: 'shell', input: { command: 'ls' } })               // []
 */

/*
 * 会碰文件的工具。判断标准是"这个工具能不能通过参数直接指到一个文件"：
 * shell 也能改文件，但它的参数是一整条命令，看不清要碰哪里，所以不在这里，
 * 它由权限规则那一层管。
 */
export const FILE_TOOLS = ['file_read', 'file_write', 'file_list', 'edit', 'apply_patch', 'glob', 'grep']

// --- 取出这次调用要碰的文件路径 ---
export const toolFiles = ({ toolName, input }) => {
    // 不碰文件的工具没有路径可谈。
    if (!FILE_TOOLS.includes(toolName)) return []
    // 补丁工具一次改多个文件，参数是数组；其余文件工具是单个 path。
    if (toolName === 'apply_patch') return (input?.patches || []).map(patch => patch.path).filter(Boolean)
    return input?.path ? [input.path] : []
}
