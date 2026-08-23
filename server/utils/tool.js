/* 
目标被调用形式（绝对不可修改）：
// 积木 1：扫描工具（Agent 循环开始时调用一次）
const tools = await Tool.scan(directory = "/path/to/tools")

// 积木 2：执行工具（模型调工具时调用）
const result = await Tool.execute({
    name: "finish",              // 要执行哪个工具
    input: {                     // 工具参数，直接传给工具的 execute
        result: "任务完成",
    },
    tool: func,                // 工具快照，用来找到 finish 这个工具
    signal: abortSignal     // 触发即杀，工具瞬间死
}) 
*/