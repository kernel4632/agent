/*
外部能力 HTTP 插件：汇总 MCP、LSP、Skills 和统一工具列表，并支持一次重载全部能力。
插件只编排独立指令，不管理连接、子进程或扫描状态。
调用示例：new Elysia().use(capabilityRoutes)。
*/
import { Elysia } from 'elysia'                       // 引入可组合的路由插件能力
import { LSP } from '../commands/lsp.js'              // 引入语言服务器查询和重载指令
import { MCP } from '../commands/mcp.js'              // 引入 MCP 查询和重载指令
import { Skill } from '../commands/skill.js'          // 引入 Skill 查询和重载指令
import { Tool } from '../commands/tool.js'            // 引入统一工具目录查询
import { store } from '../store.js'                   // 引入 Skill 扫描错误状态


// --- 汇总当前能力状态 ---
function list() {
  return {
    tools: Tool.list(),                               // 返回全部模型可见工具
    mcp: MCP.list(),                                  // 返回 MCP 配置和连接状态
    lsp: LSP.list(),                                  // 返回语言服务器运行状态
    skills: Skill.list(),                             // 返回渐进披露的 Skill 元数据
    skillErrors: store.capabilities.skillErrors,      // 返回最近一次扫描错误
  }
}


// --- 重载全部外部能力 ---
async function reload() {
  const [mcp, lsp, skills] = await Promise.all([MCP.reload(), LSP.reload(), Skill.reload()]) // 三类能力相互独立，可并行重建
  return { ok: true, mcp: mcp.servers, lsp: lsp.servers, skills: skills.skills, skillErrors: skills.errors || [] } // 反馈本次真实运行结果
}


export const capabilityRoutes = new Elysia({ name: 'agent.routes.capability', prefix: '/capability' }) // 能力 API 使用独立前缀插件
  .get('/list', list)                                  // 返回配置与运行状态快照
  .post('/reload', reload)                             // 重建全部外部能力
