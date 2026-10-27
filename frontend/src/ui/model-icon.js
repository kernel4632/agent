/*
 * 模型品牌图标：按模型 ID 和供应商名匹配，匹配不到时返回空，由组件显示通用图标。
 * 只做字符串判断，不加载图片，方便单元测试。
 * 调用示例：modelIconKey('glm-4.6', '智谱') === 'glm'
 */

// 顺序有影响：先匹配更具体的模型家族，再匹配供应商。
const PATTERNS = [
  [/claude/, 'claude'],
  [/anthropic/, 'anthropic'],
  [/gemini|nano-banana/, 'gemini'],
  [/gemma/, 'gemma'],
  [/\b(gpt|openai|o[1-9])\b/, 'openai'],
  [/deepseek/, 'deepseek'],
  [/grok|\bxai\b/, 'grok'],
  [/qwen|qwq|qvq|wanx/, 'qwen'],
  [/doubao|豆包|火山/, 'doubao'],
  [/glm|zhipu|智谱/, 'glm'],
  [/kimi|moonshot|月之暗面/, 'kimi'],
  [/mistral/, 'mistral'],
  [/openrouter/, 'openrouter'],
  [/ollama/, 'ollama'],
  [/llama|\bmeta\b/, 'meta'],
  [/minimax/, 'minimax'],
  [/hunyuan|tencent|腾讯/, 'hunyuan'],
  [/step|阶跃/, 'stepfun'],
  [/cohere|command-/, 'cohere'],
  [/perplexity/, 'perplexity'],
  [/nvidia/, 'nvidia'],
  [/longcat/, 'longcat'],
  [/mimo|xiaomi|小米/, 'mimo'],
  [/silicon|硅基/, 'siliconflow'],
]

export function modelIconKey(model = '', provider = '') {
  const text = `${model} ${provider}`.toLowerCase()
  const found = PATTERNS.find(([pattern]) => pattern.test(text))
  return found ? found[1] : ''
}
