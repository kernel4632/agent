/*
标题生成功能：用用户的第一句话调 LLM 生成一个简短的会话标题。
生成后更新工作区摘要并通过 SSE 通知前端。
调用示例：await Title.generate('session-xxx', '帮我分析性能问题')。
*/
import { store } from '../store.js'                      // 引入配置和工作区数据
import { LLM } from '../utils/llm.js'                    // 引入 LLM 流式请求能力
import { SSE } from '../utils/sse.js'                    // 引入 SSE 广播能力
import { File } from '../utils/file.js'                  // 引入文件写入能力
import { join } from 'node:path'                         // 引入路径拼接能力

const SYSTEM = '根据用户发送的第一条消息生成一个简短的会话标题。要求：不超过15个字，只返回标题文本，不加引号，不加标点，不解释。'


// --- 生成标题 ---
async function generate(sessionID, prompt, { dataDirectory } = {}) {
  const result = await LLM.chat({
    url: store.config.provider.api,
    key: store.config.provider.key,
    model: store.config.provider.models?.[0] ?? 'gpt-4',
    system: SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    tools: {},
  })

  const title = result.content.trim() || '新对话'

  for (const workspace of Object.values(store.workspaces)) {
    const found = workspace.sessions.find((s) => s.id === sessionID)
    if (found) { found.title = title; break }
  }

  if (dataDirectory) await File.write(join(dataDirectory, 'workspace.json'), JSON.stringify(store.workspaces, null, 2) + '\n')
  if (store.runtime[sessionID]) SSE.broadcast(store.runtime[sessionID].clients, 'title', { title })
  return title
}


export const Title = { generate }
