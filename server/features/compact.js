/* 
目标被调用形式（绝对不可修改）：
const { messages, token } = await Compact.run({
    messages: messages,            // build 后的 messages
    token: token,                  // 当前 token 数
    maxTokens: 8000,               // 最大上下文
})
*/