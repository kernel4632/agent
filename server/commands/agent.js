/*
 当前模型解析指令：从配置创建一次 Run 使用的模型快照。
 调用示例：Agent.resolve()、Agent.resolve('gpt-4.1')。
*/
import { Config } from './config.js'


// --- 解析当前或会话选择的模型快照 ---
function resolve(model) {
  const config = Config.get()
  const selectedModel = model || config.activeModel
  const provider = config.providers?.[config.activeProvider]?.models?.includes(selectedModel)
    ? config.activeProvider
    : Object.entries(config.providers ?? {}).find(([, definition]) => definition?.models?.includes(selectedModel))?.[0] || config.activeProvider
  if (!provider || !selectedModel) throw new Error('active provider and model must be configured')
  return { provider, model: selectedModel, systemPrompt: config.systemPrompt || '' }
}


export const Agent = { resolve }
