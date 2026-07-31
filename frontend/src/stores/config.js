/*
配置数据：定义脱敏运行配置和保存反馈字段。
本文件只保存 Server 返回的数据，配置读写统一由 commands/config.js 执行。
调用示例：const configStore = useConfigStore()。
*/
import { ref } from 'vue'                              // 引入配置字段需要的响应式容器
import { defineStore } from 'pinia'                    // 引入配置数据仓库定义能力

export const useConfigStore = defineStore('config', () => { // 暴露唯一配置数据结构
  const config = ref(null)                             // Server 返回的脱敏完整配置
  const isLoading = ref(false)                         // 配置是否正在读取或保存
  const isSaved = ref(false)                           // 最近一次保存是否成功
  const errorMessage = ref('')                         // 最近一次配置请求的错误说明

  return { config, isLoading, isSaved, errorMessage }  // 只暴露配置数据，不附带修改动作
})
