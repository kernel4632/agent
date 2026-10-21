/*
 * 一次工具调用会碰到哪些文件。
 *
 * 忽略规则要按这个名单判断"能不能碰"，文件快照要按这个名单决定"备份哪些"，
 * 所以它只写在这里一处。加一个新的文件工具，改这一个文件就够，测试会提醒你没忘。
 * 调用示例：
 *   toolFiles({ toolName: 'write_to_file', input: { path: 'a.txt' } })          // ['a.txt']
 *   toolFiles({ toolName: 'apply_patch', input: { patches: [{ path: 'a.js' }] } })  // ['a.js']
 *   toolFiles({ toolName: 'execute_command', input: { command: 'ls' } })        // []
 */

import { canonical } from './tool-names.js' // 旧名字也要能取到同一个路径。

/*
 * 会碰文件的工具。判断标准是"这个工具能不能通过参数直接指到一个文件"：
 * execute_command 也能改文件，但它的参数是一整条命令，看不清要碰哪里，所以不在这里，
 * 它由权限规则那一层管。
 */
export const FILE_TOOLS = ['read_file', 'write_to_file', 'list_files', 'edit', 'apply_patch', 'glob', 'search_files']

// --- 取出这次调用要碰的文件路径 ---
export const toolFiles = ({ toolName, input }) => {
    const name = canonical(toolName)
    // 不碰文件的工具没有路径可谈。
    if (!FILE_TOOLS.includes(name)) return []

    // 补丁工具一次改多个文件，参数是数组；其余文件工具是单个路径。
    if (name === 'apply_patch') {
        return (input?.patches || []).map(patch => patch.path ?? patch.file_path).filter(Boolean)
    }
    const path = input?.file_path ?? input?.path // edit 用 file_path，其余用 path。
    return path ? [path] : []
}
