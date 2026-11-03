/*
 * 服务装配：把有状态 feature 需要的兄弟服务接起来。
 *
 * feature 之间约定不互相 import，缺的能力由命令层在这里注入。
 * 三个命令文件都在自己的顶部调用 bind()，装配内容只写这一处：
 * 加一项依赖改这个文件，不要回到命令文件里各写一份 Agent.bind(...)。
 *
 * 调用示例：
 *   import bind from './bind.js'
 *   bind()
 */

import Agent from '../features/agent.js'
import Approval from '../features/approval.js'
import Config from '../features/config.js'
import Context from '../features/context.js'
import History from '../features/history.js'
import Mcp from '../features/mcp.js'
import Tool from '../features/tool.js'

const bind = () => {
    Tool.bind({ mcp: Mcp })                                                              // 工具表里要能取到 MCP 服务给的工具
    Approval.bind({ tool: Tool, config: Config })                                        // 审批要查工具类别，并把“始终允许”写回配置
    Agent.bind({ history: History, tool: Tool, approval: Approval, context: Context })   // 会话装配要读历史、工具表、审批和上下文
}

export default bind
