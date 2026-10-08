/*
 * Agent 控制工具：结束循环、向用户提问、记任务清单。
 *
 * 工具只描述模型可以触发的动作，不读取会话数据，也不发送 HTTP 反馈。
 * 调用 finish / ask 后工具返回 stop: true，主循环停止，等用户下一条消息。
 *
 * 描述的写法学 roo code 的 attempt_completion：把"什么时候必须用我"写成明确规则，
 * 而不是只写"干什么"。只写"干什么"时模型会犹豫——实测 kimi-k2.6 面对一句
 * "你好"会在 ask / finish / todo 之间转圈，因为它认为"没有任务，谈不上完成"，
 * 于是不停尝试别的工具，形成回复循环。
 */

// --- 结束 Agent 循环 ---
const finish = {
    name: 'finish',
    /*
     * 这段描述是在回答模型的两个疑问：
     *   1. "没有任务，我也该调吗？"——该。回答完话、答完问题、干完活，都靠它收尾。
     *   2. "什么时候才轮到它？"——手里没有要执行的下一步了，就轮到它。
     * 最后一句是防循环的关键：不调用它，循环不会自己停。
     */
    description: [
        '向用户呈现这一轮的最终回复，并结束本轮。',
        '每当你要回应用户——回答了问题、完成了任务、给出了说明或结论——就用这个工具把回复交出去；没有"正在执行的任务"时也一样用，回答本身就是结果。',
        '不要用它汇报中间进度：手里还有要做的下一步（还要读文件、改代码、跑命令）时，先去做，做完再收尾。',
        '回复要完整成文，不要以提问或"还需要我做什么吗"结尾。',
        '不调用这个工具，本轮对话不会结束。',
        '参数 result：要交给用户的最终回复。',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { result: { type: 'string', description: '要交给用户的最终回复，完整成文' } },
        required: ['result'],
    },
    // finish 的结果会让主循环停止，不再请求下一轮模型。
    execute: input => ({ stop: true, output: { type: 'text', value: input.result } }),
}

// --- 暂停 Agent 循环并询问用户 ---
const ask = {
    name: 'ask',
    description: [
        '向用户提出一个问题，然后停下等回答。',
        '只在缺了关键信息、不问就做不下去时用：要改哪个文件、账号是什么、按哪种方案做。',
        '问题要具体，能答就答，不要把"你想让我做什么"这种空泛问题丢回给用户。',
        '用户的回答会作为下一条消息进来，届时继续。',
        '参数 question：要问的问题。',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: { question: { type: 'string', description: '要问用户的问题，要具体' } },
        required: ['question'],
    },
    // ask 同样停止循环，等用户补充信息后再发送新消息。
    execute: input => ({ stop: true, output: { type: 'text', value: input.question } }),
}

export default [finish, ask] // 一个文件导出两个控制工具。
