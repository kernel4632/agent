/*
循环控制工具：finish 表示任务完成，ask_user 表示必须等待下一条用户消息。
两者只是普通可插拔工具，删掉文件后模型就失去主动停止循环的能力。
*/
import type { AgentTool } from '../types.ts'

const finish: AgentTool = {
    name: 'finish',
    description: 'Stop the agent loop because the requested task is complete.',
    inputSchema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false },
    execute(input) {
        return { output: input, stop: true }
    },
}

const askUser: AgentTool = {
    name: 'ask_user',
    description: 'Stop the loop and ask the user for information that cannot be discovered with tools.',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false },
    execute(input) {
        return { output: input, stop: true }
    },
}

export default [finish, askUser]
