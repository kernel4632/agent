/*
工具数据仓库：保存模型可见的工具注册表和目录监听器。
每个注册项包含 name、description、parameters、execute、source 和 filePath。
调用示例：toolStore.items.get('task_done')、toolStore.watcher.close()。
*/

// --- 保存工具状态 ---
export const toolStore = {                         // 工具加载与对话指令共享的唯一注册表
  items: new Map(),                                // 工具名称到完整工具定义的映射
  watcher: null,                                   // chokidar 监听器，关闭应用时统一释放
  directories: [],                                 // 当前扫描的内置与自定义工具目录
}
