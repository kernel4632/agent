/*
基础工具：把本目录 tools/ 下的工具文件登记给每一个 Agent。
工具自己处理快照、敏感文件、截断和风险说明；这里只负责挂上和拔出。
*/

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), 'tools')
const files = ['read_file.js', 'write_file.js', 'edit_file.js', 'list_dir.js', 'shell.js', 'webfetch.js', 'finish.js']

/** @param {import('agent-backend').Ctx} ctx */
export default ctx => {
    for (const file of files) ctx.tool(join(dir, file))
}
