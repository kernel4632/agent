/*
 * 会话的 Agent 实例：装配配置、工具表，并按会话编号缓存。
 *
 * Agent 的模型请求和循环由 @kernel4632/agent-core 负责；这里只准备它运行所需的东西。
 * 调用示例：
 *   const agent = await AgentSession.get({ sessionId, meta })
 *   await AgentSession.create({ sessionId, history, meta })
 */

import { mkdir } from 'node:fs/promises'
import Agent from '@kernel4632/agent-core'
import Approval from '../safety/approval.js' // 工具执行前过同一道审批关口。
import Delegation from './subtask.js' // 把独立探索工作委托给子 agent。
import Mcp from '../tool/mcp.js' // 把设置里配置的外部工具服务连上。
import Rules from '../config/rules.js' // 工作区的项目规则，跟着 system 一起交给模型。
import Skills from '../tool/skills.js' // 数据目录里的技能，按需读正文。
import Config from '../config/config.js' // 读取全局模型配置和权限规则。
import Settings from '../config/settings.js' // 会话运行设置：模式、自动批准、能力开关。
import Kind from '../tool/kind.js' // 工具分类由工具自己声明，plan 模式只读运行时表。
import ToolCatalog from '../tool/catalog.js' // 扫描工具时登记类别和文件参数。
import History from './history.js' // 新会话第一次建 Agent 时要从历史读起。
import Store from '../state/store.js' // 直接访问会话到 Agent 实例的映射。
import Path from '../utils/path.js' // 生成数据目录路径。

// --- 这一轮的运行配置：会话设置、工作区规则和模型连接 ---
const configFor = async ({ sessionId, meta }) => {
    // 会话的运行设置：智能体、自动批准、能力开关。
    const settings = await Settings.read({ sessionId })
    // 规则跟着工作区和智能体走；每次重建 Agent 都重读一次，用户改完规则不用重启服务。
    await Rules.load({ agent: settings.agent })
    // 配置格式转换只写在 Config 里，子 agent 用的也是同一份；
    // 能力开关作为会话级覆盖并进去，system 保持用户原样，不做任何注入。
    const config = Config.resolve({ provider: meta.provider, model: meta.model, settings: Settings.toAgentConfig({ settings }) })
    return { settings, config }
}

// --- 这一轮的工具表：内置、用户工具、MCP、技能，再按智能体裁剪 ---
const toolsFor = async ({ sessionId, settings, config }) => {
    // 内置工具跟着代码走，用户工具放在数据目录，同名时用户版覆盖内置版。
    // 用户工具目录可能在启动流程之外被用到（测试、脚本），这里直接建出来不让它缺。
    await mkdir(Path.tools(), { recursive: true })
    // 三类工具一起交给模型：内置的文件工具、用户自己写的、设置里配的 MCP 服务。
    // 技能不作为工具全集出现，只给一个"读技能正文"的工具，正文等模型要用时才去读。
    // 工具文件自己声明类别和文件参数，扫描时登记；审批和快照都依赖这份表。
    await ToolCatalog.register()
    const scanned = await Agent.tool.from(
        new URL('../tools/', import.meta.url),
        Path.tools(),
        await Mcp.tools({ sessionId }),
        await Skills.tools(),
    )

    /*
     * 自定义智能体可以点名只给哪些工具；内置的执行和计划不点名。
     * 点名的名单里不存在的工具直接忽略，用户写错一个名字不该让整个会话打不开。
     */
    const toolNames = Settings.toolsFor({ agent: settings.agent })
    let allowed = toolNames
        ? Agent.tool.pick(scanned, toolNames.filter(name => name in scanned.schema))
        : scanned

    /*
     * readOnly 智能体去掉能改磁盘的工具。哪些算"能改"由 tool/kind.js 一处说了算，
     * 这里只是把它对当前工具表算一遍，不另外维护一份名单。
     * omit 会把 schema 和 handlers 一起筛，不会出现"模型看不见、却还能被执行"的隐蔽状态。
     *
     * 这一步必须在装 new_task 之前做：子 agent 拿的是这里选出来的这张表。
     * 反过来（先装 new_task 再筛）会留一个口子——只读智能体的模型自己虽然改不了文件，
     * 但它可以开一个子任务，让子任务去改，等于绕过了"只看不做"。
     */
    if (config.readOnly) allowed = Agent.tool.omit(allowed, Kind.writing(Object.keys(allowed.schema)))

    // new_task 必须在同一进程里才有模型配置和工具表可用，所以它是内存工具而不是文件工具。
    // merge 把已经装好的文件工具表和这一件内存工具合起来，两边形状不用自己转。
    // 自定义智能体没点名 new_task 时就不装，让"只留几个工具"真的只留那几个。
    const withTask = !toolNames || toolNames.includes('new_task')
    return withTask
        ? Agent.tool.merge(allowed, Agent.tool.adopt({ new_task: Delegation.build({ config, tools: allowed, sessionId }) }))
        : allowed
}

// --- 为一个会话建出 Agent 实例 ---
const create = async ({ sessionId, history, meta }) => {
    const { settings, config } = await configFor({ sessionId, meta })
    const tools = await toolsFor({ sessionId, settings, config })
    const agent = Agent.create({
        id: sessionId,
        history,
        config,
        tools,
        callbacks: { onPermission: Approval.check }, // 工具执行前先过一次忽略规则和权限规则。
    })
    Store.agents.set(sessionId, agent)
    return agent
}

// --- 获取或创建 Agent ---
const get = async ({ sessionId, meta }) => {
    const current = Store.agents.get(sessionId)
    if (current) return current
    await History.load({ sessionId })
    return create({ sessionId, history: History.get({ sessionId }), meta })
}

export default { create, get }
