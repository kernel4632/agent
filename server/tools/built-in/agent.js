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
