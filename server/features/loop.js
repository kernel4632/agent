/* 
目标被调用形式（绝对不可修改）：
const result = await Loop.run({
    // --- 数据（必填）---
    messages: [],               // 完整消息列表
    system: "你是编程助手",         // 系统提示词
    tools: [],                  // 工具列表

    // --- LLM 参数（必填，内部传给 LLM.chat）---
    llm: {
        // 连接
        baseURL: "https://中转站/v1",
        apiKey: "sk-xxx",
        model: "model-name",
        protocol: "chat",          // chat / responses / anthropic
        // 参数覆盖
        options: {
            headers: {},
            body: {},
        },
    },
    retry: {
        maxDelay: 60000,
    },
    // --- 功能模块（必填，平齐的功能模块作为参数传）---
    buildContext: Context.build,       // 上下文构建模块
    compressContext: Compress.run,     // 上下文压缩模块
    checkApproval: Approve.check,      // 工具审批模块

    // --- 控制（可选）---
    signal: abortSignal,           // 取消信号

    // --- 回调（全部可选）---
    onStart: () => { },                    // 循环开始
    onText: (text) => { },                 // 流式文字增量
    onRetry: (info) => { },                // 请求失败重试中
    onToolCall: (call) => { },             // 模型调了工具
    onApprove: async (approval) => { },    // 需要用户批准，返回 true/false
    onToolResult: (result) => { },         // 工具执行完
    onCompress: (summary) => { },          // 上下文压缩发生
    onFinish: (result) => { },             // 循环结束
})
*/