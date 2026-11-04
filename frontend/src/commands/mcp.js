/*
 * MCP 页的本机识别与导入。
 *
 * 已配置服务的增删改仍然走设置草稿和 /config/set；这里只补充“从本机其他软件识别”和“连接测试”两件事。
 * 导入后通知设置草稿重新读取配置，页面只刷新 MCP 列表，不丢其他未保存的输入。
 * 调用示例：
 *   const catalog = await Mcp.load()
 *   await Mcp.importServers(['cursor::github'])
 *   const result = await Mcp.test('github')
 */

import { AgentAPI } from '../utils/api.js'
import { store } from '../store.js'
import { Notice } from './notice.js'

const cwd = () => store.sessions[store.ui.activeSessionID]?.cwd || ''

async function run(action) {
  try {
    return await action()
  } catch (error) {
    Notice.show(error.message)
    return null
  }
}

const load = () => run(() => AgentAPI.getMcpCatalog(cwd()))
const importServers = ids => run(() => AgentAPI.importMcpServers(ids, cwd()))
const test = name => run(() => AgentAPI.testMcpServer(name))

// --- 识别结果列表里的传输目标摘要 ---
const describeTarget = definition => {
  if (!definition) return ''
  if (definition.url) return definition.url
  return [definition.command, ...(definition.args || [])].filter(Boolean).join(' ')
}

export const Mcp = { load, importServers, test, cwd }
export { describeTarget }
