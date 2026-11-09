/*
 * 全局数据中心：程序里所有长期数据都长在这个对象上。
 *
 * 这里只放可序列化的数据，打开文件就能看到全局配置和每条会话的样子。
 * 运行中的 Agent、等待审批的 resolve、文件快照清单这些不能写进磁盘的东西，
 * 由使用它们的模块自己保管，不放在这里。
 *
 * 调用示例：
 *   store.config.permission               // 工具权限规则
 *   store.config.models.compact           // 压缩上下文默认用哪个模型
 *   store.sessions['session-id'].cwd      // 这条会话当前站在哪个目录
 *   store.sessions['session-id'].history  // 这条会话的消息和回退栈
 */

// 第一次使用时写进 config.prompt.system 的默认内容。
// 放在数据文件里，配置和上下文都从这里取，两个 feature 不用互相 import。
export const DEFAULT_PROMPT = `You are a general-purpose agent working on whatever the user asks for, in their current folder.

# Working style
- Understand the request before acting. Look at the real situation instead of guessing — read the file, check the folder, run the command, fetch the page.
- Ask when a decision is genuinely ambiguous; otherwise make the smallest correct change and say what you did.
- Do not claim something happened or invent a result. Wait for the real one before deciding the next step.
- Reply in the user's language unless they ask for another language.
- Do not reveal API keys or private file contents unless the user explicitly asked.

# Tool use
- Prefer the dedicated tool over a shell command that does the same job, and prefer the smallest tool that answers the question.
- For a multi-step task, use update_todo_list to show the plan and update it as work progresses. Skip it for one-step requests.
- On a long task, call ctx_usage now and then: if the context is close to compaction, persist what matters to a file before it is dropped.
- For anything that might take more than a few seconds, start it in the background and read its log rather than blocking.
- Ask the user with ask_followup_question only when missing information blocks the task.
- Finish every conversational turn by calling attempt_completion with the complete user-facing reply. This includes greetings, casual conversation, direct answers, and completed tasks.
- No task or previous tool use is required. If a greeting or question can be answered directly, call attempt_completion immediately with that answer.
- Put the complete reply in attempt_completion.result instead of normal assistant text. This ends your current turn and waits for the next user message; it does not close the conversation.

# Objective
Work through the user's goal methodically. Each step should be informed by the previous tool result. Finish with a complete result the user can act on.`

// 工具类别：工具文件和设置页共用，避免互相 import。
export const TOOL_KINDS = [
    { kind: 'read', label: '读取', hint: '读文件、列目录、搜文件内容、抓网页' },
    { kind: 'write', label: '写入', hint: '改文件、打补丁' },
    { kind: 'command', label: '执行命令', hint: '跑命令' },
    { kind: 'mcp', label: '使用 MCP', hint: 'MCP 服务提供的工具' },
    { kind: 'subtask', label: '创建子任务', hint: '开一个子任务去干活' },
]

const store = {
    config: {
        // 模型服务。每个模型自己带上下文长度和能力，不再有全局能力表。
        providers: [
            // {
            //     name: 'local',
            //     baseURL: 'http://127.0.0.1:11434/v1',
            //     apiKey: '',
            //     models: [
            //         {
            //             id: 'qwen3',
            //             name: 'Qwen3',
            //             context: 128000,
            //             capabilities: ['text', 'tools', 'image'],
            //         },
            //     ],
            // },
        ],

        // 不同任务可以分别指定默认模型；不填就回退到 chat 或会话自己的模型。
        models: {
            chat: { provider: '', model: '' },
            compact: { provider: '', model: '' },
            title: { provider: '', model: '' },
            task: { provider: '', model: '' },
        },

        // 外部工具服务：一个服务一项，键是服务名。
        mcp: {},

        // 工具权限规则：allow / ask / deny。
        permission: {},

        // 用户自己写的系统提示词；seeded 表示默认值已经填过一次。
        prompt: { system: '', seeded: false },

        // 上下文用到这个比例时自动压缩。
        compact: { threshold: 0.8 },

        // 压缩后还留多少总结之前的原文。
        // firstTurns = 0 表示只信总结 + 最近现场，不再带最初那几轮原始对话。
        contextKeep: { firstTurns: 3, recentTurns: 3, firstShare: 0.2, recentShare: 0.3 },
    },

    // 每条会话一个键。会话是唯一的长期容器，目录只是它的一个属性。
    sessions: {
        // [id]: {
        //     id: 'session-id',
        //     title: '新对话',
        //     cwd: 'D:/notes',
        //     model: { provider: 'local', model: 'qwen3' },
        //     createdAt: 0,
        //     updatedAt: 0,
        //     history: { messages: [], redo: [] },
        //     settings: {
        //         reasoning: 'auto',
        //     },
        // },
    },
}

export default store
