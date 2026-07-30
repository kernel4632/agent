/*
配置数据仓库：保存当前运行配置及对应的磁盘位置。
本文件只描述状态，不负责读取、合并或写入配置。
调用示例：configStore.value.activeModel、configStore.filePath。
*/

// --- 保存配置状态 ---
export const configStore = {                       // 集中保存配置状态，避免指令间隐式传递
  value: null,                                     // 当前生效的完整配置，启动加载前为空
  filePath: '',                                    // 配置持久化文件的绝对路径
}
