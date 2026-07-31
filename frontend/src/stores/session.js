/*
会话数据仓库：读取摘要列表、创建、获取和删除真实 Server 会话。
仓库只管理 Server 会话资源，顶部选择由 tabs store 保存，消息由 chat store 按标签隔离。
调用示例：await sessions.refresh()、await sessions.select('ses_xxx')。
*/
import { ref } from 'vue'                           // 引入 Vue 响应式会话数据
import { defineStore } from 'pinia'                 // 引入 Pinia 数据仓库定义能力
import { AgentAPI } from '../api.js'                // 引入会话 HTTP 指令

export const useSessionStore = defineStore('session', () => { // 导出唯一会话仓库
  const sessions = ref([])                          // 按更新时间倒序保存会话摘要
  const isLoading = ref(false)                      // 列表或详情请求进行状态
  const errorMessage = ref('')                      // 最近一次会话请求错误


  // --- 刷新会话列表 ---
  async function refresh() {
    isLoading.value = true                          // 列表区域进入加载反馈
    errorMessage.value = ''                         // 新请求开始时清除旧错误
    try {
      sessions.value = await AgentAPI.listSessions() // 从真实 Server 读取最新摘要
      return sessions.value                         // 反馈列表供视图继续选择
    } catch (error) {
      errorMessage.value = error.message            // 保存错误供侧栏就地展示
      return []                                     // 请求失败时返回空结果但保留旧数据
    } finally {
      isLoading.value = false                       // 无论结果如何都结束加载状态
    }
  }


  // --- 创建并选中新会话 ---
  async function create() {
    const session = await AgentAPI.createSession()  // 请求 Server 创建真实磁盘会话
    await refresh()                                 // 刷新侧栏以展示新条目
    return session                                  // 反馈空会话供聊天 store 加载
  }


  // --- 读取并选中会话 ---
  async function select(sessionID) {
    isLoading.value = true                          // 主对话区进入详情加载状态
    errorMessage.value = ''                         // 清除上一次加载错误
    try {
      const session = await AgentAPI.getSession(sessionID) // 从 Server 读取完整历史
      return session                                // 反馈完整消息给 Chat 视图
    } catch (error) {
      errorMessage.value = error.message            // 保存不存在或网络错误
      return null                                   // 失败时不替换聊天内容
    } finally {
      isLoading.value = false                       // 结束详情加载反馈
    }
  }


  // --- 删除一个会话 ---
  async function remove(sessionID) {
    const result = await AgentAPI.removeSession(sessionID) // 删除 Server 内存和磁盘数据
    if (!result.ok) return false                    // Server 拒绝时保持当前列表
    await refresh()                                 // 用真实 Server 状态更新侧栏
    return true                                     // 反馈删除动作完成
  }


  // --- 重命名一个会话 ---
  async function rename(sessionID, title) {
    errorMessage.value = ''                         // 新的标题请求清除旧列表错误
    try {
      const result = await AgentAPI.renameSession(sessionID, title) // 将清理和长度校验交给 Server
      const summary = sessions.value.find((item) => item.id === sessionID) // 定位主页使用的同一摘要
      if (summary) Object.assign(summary, { title: result.title, titleSource: result.titleSource }) // 原位同步主页标题
      return result                                  // 反馈标题供标签和聊天顶栏同步
    } catch (error) {
      errorMessage.value = error.message             // 在触发重命名的页面展示失败原因
      return null                                    // 保持旧标题并让编辑器继续打开
    }
  }


  // --- 读取一个会话的任务 ---
  async function readTasks(sessionID) {
    try {
      return await AgentAPI.getTasks(sessionID)      // 独立刷新任务时读取最新修订
    } catch (error) {
      errorMessage.value = error.message             // 任务读取失败复用会话错误反馈
      return null                                    // 不用空清单覆盖仍可见的旧任务
    }
  }


  // --- 按修订号更新一个会话的任务 ---
  async function updateTasks(sessionID, tasks, taskRevision) {
    try {
      return await AgentAPI.updateTasks(sessionID, tasks, taskRevision) // Server 检测并发修改
    } catch (error) {
      errorMessage.value = error.message             // 冲突或验证错误交给视图展示
      return null                                    // 保持当前清单等待重新读取
    }
  }


  return { sessions, isLoading, errorMessage, refresh, create, select, remove, rename, readTasks, updateTasks } // 暴露 Server 会话资源与动作
})
