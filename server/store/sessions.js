/*
会话数据仓库：保存会话映射和持久化存储实例。
会话结构包含 id、title、时间戳、messages 和 rollbackCache，字段含义在 create 指令中显式定义。
调用示例：sessionStore.items.get(sessionID)、sessionStore.storage.setItem(sessionID, session)。
*/

// --- 保存会话状态 ---
export const sessionStore = {                      // 会话指令共享的唯一运行时数据源
  items: new Map(),                                // sessionID 到完整会话对象的映射
  writes: new Map(),                               // sessionID 到最后一次磁盘写入，保证同会话保存顺序
  storage: null,                                   // unstorage 实例，启动加载前为空
}
