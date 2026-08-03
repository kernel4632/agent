/*
Agent 工具：让模型明确声明当前任务已经完成。
stop 只反馈给 Agent 循环，不写入 store 的工具结果结构。
调用示例：await finishTool.execute({ summary: '任务已完成' })。
*/

// --- 完成当前任务 ---
export const finishTool = {
  name: 'finish',                                       // LLM 调用使用的稳定工具名
  description: '当用户任务已经完成时调用，并简要说明完成结果。', // 告诉模型何时结束循环
  inputSchema: {
    type: 'object',                                     // 工具输入必须是对象
    properties: {
      summary: { type: 'string', description: '任务完成摘要' }, // 最终结果说明
    },
    required: ['summary'],                              // 完成工具必须给出摘要
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ summary }) {
    return { output: summary, stop: true }              // 返回摘要并通知 Agent 退出
  },
}
