/*
标题生成功能：给定一段文本，调用 LLM 流式生成一个简短的会话标题。
生成完成后更新 workspace 摘要并通过 SSE 通知前端。
调用示例：await Title.generate(sessionID, '帮我分析这段代码的性能问题')。
*/
import { store } from '../store.js'                      // 引入模型供应商配置
import { LLM } from '../utils/llm.js'                    // 引入流式 LLM 请求能力
import { Session } from '../commands/session.js'         // 引入 SSE 事件推送
import { Workspace } from '../commands/workspace.js'     // 引入工作区摘要保存

const SYSTEM = '根据用户发送的第一条消息生成一个简短的会话标题。要求：不超过15个字，只返回标题文本，不加引号，不加标点，不解释。'


// --- 生成会话标题 ---
async function generate(sessionID, prompt) {
  const result = await LLM.chat({
    url: store.config.provider.api,
    key: store.config.provider.key,
    model: store.config.provider.models?.[0] ?? 'gpt-4',
    system: SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    tools: {},
  })
  const title = result.content.trim() || '新对话'        // 模型返回空时保留默认标题
  for (const workspace of Object.values(store.workspaces)) {
    const summary = workspace.sessions.find((s) => s.id === sessionID)
    if (summary) { summary.title = title; break }        // 找到摘要后更新标题
  }
  await Workspace.save()                                 // 持久化更新后的工作区数据
  Session.emit(sessionID, 'title', { title })            // SSE 通知前端更新标题
  return title
}


export const Title = { generate }
