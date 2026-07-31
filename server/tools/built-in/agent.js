/*
Agent 控制工具集：向对话循环明确反馈任务已经结束。
该工具不修改外部数据，stop 字段由对话指令识别并终止循环。
调用示例：await task_done.execute({ summary: '已完成测试' })。
*/

// --- 完成当前任务 ---
export const task_done = {                                 // 导出模型可调用的任务结束工具
  description: '当任务已经全部完成时调用，并用 summary 简要说明完成结果。', // 告诉模型何时终止循环
  parameters: {                                            // 参数结构由工具指令转换为 Zod schema
    summary: { type: 'string', description: '任务完成情况摘要', required: true }, // 必填的最终结果说明
  },
  async execute({ summary }) {
    return { result: summary, stop: true }                  // 将摘要反馈给模型并通知循环停止
  },
}


// --- 替换当前会话任务清单 ---
export const task_list_update = {                          // 导出模型可调用的任务规划工具
  description: '更新当前会话的完整任务清单，用于记录任务状态和优先级。', // 告诉模型每次提交完整清单
  parameters: {                                           // 数组对象结构由对话指令递归转换为 Zod schema
    tasks: {
      type: 'array',                                      // 顶层参数是完整任务数组
      required: true,                                     // 每次调用必须明确提供清单
      items: {
        type: 'object',                                   // 每个数组元素是一项任务
        properties: {
          content: { type: 'string', description: '任务内容', required: true }, // 任务必须说明要完成的动作
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'], required: true }, // 状态使用稳定枚举
          priority: { type: 'string', enum: ['high', 'medium', 'low'], required: true }, // 优先级使用稳定枚举
        },
      },
    },
  },
  async execute({ tasks }, context) {
    return context.updateTasks(tasks)                     // 由 Chat 注入当前会话持久化动作并发送 SSE 反馈
  },
}


// --- 派生一个共享环境中的子 Agent ---
export const spawn_agent = {                                // 导出模型可调用的子智能体工具
  description: '将一个明确的独立子任务交给另一个 Agent。子 Agent 与当前任务共享工具、权限、MCP、LSP、Skills 和工作区，只返回结果，不直接写入父模型历史。',
  parameters: {
    prompt: { type: 'string', description: '子 Agent 要独立完成的明确任务', required: true },
    agentId: { type: 'string', description: '可选的 Agent ID；省略时使用默认 Agent' },
  },
  async execute({ prompt, agentId }, context) {
    return context.spawnAgent(prompt, agentId)              // 由 Chat 创建独立 Child Run 并等待结果
  },
}
