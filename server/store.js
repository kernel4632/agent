/*
服务端全局数据中心：只定义配置、工具、工作区和会话四类数据。
所有读写、持久化和执行逻辑都放在 commands 中，本文件不提供任何方法。
调用示例：store.config.provider.api、store.config.prompts.system、store.tools、store.workspaces、store.sessions。
*/

export const store = {
  config: {
    provider: {
      api: '',                                              // 模型 API 地址
      key: '',                                              // 模型 API Key
      models: [],                                           // 当前供应商可用模型
      maxTokens: 100000,                                    // 模型上下文窗口大小，触发压缩的阈值
    },
    prompts: {
      system: '你是一个AI Agent',                         // 每轮模型请求使用的系统提示词
      tool: '继续完成用户任务。需要外部操作时必须调用可用工具，不要只描述计划。', // 连续纯文本后使用的工具提醒
    },
    approval: {
      mode: 'none',                                         // 审批模式：none 全部放行 / all 全部审批 / selected 按列表审批
      tools: [],                                            // mode=selected 时需要审批的工具名列表
    },
    context: {
      head: 3,                                              // 压缩时保留开头消息数（用户原始需求）
      tail: 3,                                              // 压缩时保留摘要前后消息数（衔接上下文）
    },
  },
  tools: {},                                                // 启动时扫描得到的 LLM 工具定义
  workspaces: {},                                           // 按 ID 保存工作区及其会话摘要
  sessions: {},                                             // 按 ID 保存已加载的完整会话和运行时状态
}
