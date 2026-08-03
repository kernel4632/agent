/*
服务端全局数据中心：只定义配置、工具、工作区和会话四类数据。
所有读写、持久化和执行逻辑都放在 commands 中，本文件不提供任何方法。
调用示例：store.config.provider.api、store.tools、store.workspaces、store.sessions。
*/

export const store = {
  config: {
    provider: {
      api: '',                                              // 模型 API 地址
      key: '',                                              // 模型 API Key
      models: [],                                           // 当前供应商可用模型
    },
  },
  tools: [],                                                // 启动时扫描得到的 LLM 工具定义列表
  workspaces: [],                                           // 工作区及其会话摘要
  sessions: [],                                             // 已加载的完整会话和运行时状态
}
