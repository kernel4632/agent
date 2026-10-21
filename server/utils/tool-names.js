/*
 * 工具名兼容层：新名字对齐 Roo Code，旧名字仍然能被旧配置和旧模式认出来。
 *
 * 磁盘上的会话历史不会跟着改名，用户的 config.json 里也可能还写着旧名字。
 * 所以新工具只暴露 Roo 名字，内部判断统一先过 canonical()。
 * 调用示例：
 *   canonical('file_read')        // 'read_file'
 *   previousNames('read_file')    // ['file_read']
 */

export const ALIASES = {
    finish: 'attempt_completion',
    file_read: 'read_file',
    file_write: 'write_to_file',
    file_list: 'list_files',
    grep: 'search_files',
    shell: 'execute_command',
    todo: 'update_todo_list',
    ask: 'ask_followup_question',
    task: 'new_task',
}

/**
 * 把旧工具名换成现在暴露的名字。
 * @param {string} name 工具名。
 * @returns {string} 当前名字；不是旧名字时原样返回。
 */
export const canonical = name => typeof name === 'string' ? (ALIASES[name] || name) : name

/**
 * 当前工具名以前叫什么。
 * @param {string} name 当前工具名。
 * @returns {string[]} 旧名字列表；没有旧名字时是空数组。
 */
export const previousNames = name => Object.keys(ALIASES).filter(old => ALIASES[old] === canonical(name))

export default { ALIASES, canonical, previousNames }
