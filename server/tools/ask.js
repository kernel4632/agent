/*
提问工具：让模型向用户提出问题并等待回答。
返回 stop: true 退出循环，前端根据 toolName 渲染选择框，用户选择后正常发送消息。
调用示例：await askTool.execute({ question: '你想要什么颜色？', options: ['红色', '蓝色'] })。
*/


// --- 向用户提问 ---
export const askTool = {
  name: 'ask',                                            // LLM 调用使用的稳定工具名
  description: '向用户提问并等待回答。调用后任务暂停，用户回答后继续。适用于需要用户确认、选择或提供信息的场景。',
  parameters: {
    type: 'object',                                       // 工具输入必须是对象
    properties: {
      question: { type: 'string', description: '向用户提出的问题' },
      options: { type: 'array', items: { type: 'string' }, description: '可选的选项列表，不提供时用户自由输入' },
    },
    required: ['question'],                               // 问题必须提供
    additionalProperties: false,                         // 拒绝无意义参数
  },
  async execute({ question, options }) {
    const parts = [question]                              // 问题正文
    if (options?.length) parts.push(`选项: ${options.join(' / ')}`) // 选项附在问题后
    return { output: parts.join('\n'), stop: true }       // 退出循环，前端渲染选择 UI
  },
}

export default askTool
