/*
 * Agent 控制工具。
 *
 * 工具只描述模型可以触发的结束动作，不读取 store，也不发送 HTTP 响应。
 * 数据流：模型触发工具 → 工具返回 stop → Agent 循环停止 → Session 反馈结果。
 */

// --- 结束 Agent 循环 ---
const finish = { // 模型确认任务完成时调用。
    name: 'finish',
    description: '当任务完成时，调用该工具停止Agent循环',
    inputSchema: {
        type: 'object',
        properties: { result: { type: 'string' } },
        required: ['result'],
    },
    // finish 的结果会让主循环停止，不再请求下一轮模型。
    execute: input => ({ output: input, stop: true }), // 把结果原样展示并停止循环。
}

// --- 暂停 Agent 循环并询问用户 ---
const ask = { // 模型缺少外部信息时调用。
    name: 'ask',
    description: '当需要向用户询问信息时，调用该工具向用户询问',
    inputSchema: {
        type: 'object',
        properties: { question: { type: 'string' } },
        required: ['question'],
    },
    // ask 同样停止循环，等待用户补充信息后再发送新消息。
    execute: input => ({ output: input, stop: true }), // 保留问题并等待下一条用户消息。
}

export default [finish, ask] // 一个文件导出两个控制工具。
