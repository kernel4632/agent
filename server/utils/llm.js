/* 
目标被调用形式（绝对不可修改）：
const result = await LLM.chat({
    // --- 连接（每次传，或初始化配置后省略）---
    baseURL: "https://中转站/v1",
    apiKey: "sk-xxx",
    model: "model-name",
    protocol: "chat",//模型协议，responses、anthropic……，默认chat
    messages: [...],                // 必填

    // --- 工具（可选）---
    tools: [...],
    toolChoice: "required",
    parallelToolCalls: true,
    // --- 流式与回调 ---
    stream: true,
    onChunk: (chunk) => { ... },    // 流式时每段文字回调
    // --- 控制信号 ---
    signal: abortSignal,            // 取消信号，外部随时能打断
    // --- 自定义请求头或请求体 ---
    options: {
    headers: {},                    // 额外请求头
    body: {},                        // 额外请求体
    }
}); 
*/