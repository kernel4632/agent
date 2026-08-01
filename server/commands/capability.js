/*
能力指令：汇总和重载 MCP、LSP、Skills 与统一工具目录。
HTTP 入口只触发这里的单一动作，跨能力编排和状态读取不再散落在 Route。
调用示例：Capability.list()、await Capability.reload()。
*/
import { LSP } from './lsp.js'       // 引入语言服务器状态与重载动作
import { MCP } from './mcp.js'       // 引入 MCP 状态与重载动作
import { Skill } from './skills.js'  // 引入 Skill 状态与重载动作
import { Tool } from './tool.js'     // 引入统一工具目录
import { store } from '../store.js'  // 引入能力扫描错误状态


// --- 列出全部能力状态 ---
function list() {
  return {
    tools: Tool.list(),                                  // 返回全部模型可见工具
    mcp: MCP.list(),                                     // 返回 MCP 配置和连接状态
    lsp: LSP.list(),                                     // 返回语言服务器运行状态
    skills: Skill.list(),                                // 返回渐进披露 Skill 元数据
    skillErrors: structuredClone(store.capabilities.skillErrors), // 返回不可被入口修改的扫描错误
  }
}


// --- 重载全部外部能力 ---
async function reload() {
  const [mcp, lsp, skills] = await Promise.all([MCP.reload(), LSP.reload(), Skill.reload()]) // 三类能力相互独立并行重建
  return { ok: true, mcp: mcp.servers, lsp: lsp.servers, skills: skills.skills, skillErrors: skills.errors || [] } // 反馈真实重载结果
}


export const Capability = { list, reload } // 暴露能力中心的两个业务动作
