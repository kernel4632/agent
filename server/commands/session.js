/* 会话保存消息，运行态保存 SSE、进程和审批等待者。 */
import { rm } from 'node:fs/promises' // 删除会话落盘目录。
import { nanoid } from 'nanoid' // 为新会话生成稳定 ID。
import Store from '../store.js' // 维护会话、摘要和运行态真相。
import Path from '../utils/path.js' // 定位会话自己的数据目录。

const read = id => Store.sessions[id] || null // 找不到时明确返回空会话。

const create = async (workspaceID, provider, model) => {
    const workspace = Store.workspaces[workspaceID] // 新会话必须挂在现有工作区下。
    if (!workspace) throw new Error('Workspace not found') // 避免产生无法索引的孤儿会话。

    const session = { id: nanoid(), workspaceID, provider, model, messages: [] } // 从空白历史开始。
    Store.sessions[session.id] = session // 先登记业务数据，再建立运行态。
    Store.runtimes[session.id] = {
        status: 'idle', // 新会话尚未运行 Agent。
        abortController: new AbortController(), // 下一次工作可直接替换此控制器。
        clients: new Set(), // 保存当前 SSE 连接。
        processes: new Set(), // 保存可被 stop 终止的子进程。
        permission: new Map(), // 保存正在等待的审批回调。
        events: [], // 保存断线后需要重放的本轮事件。
    }

    workspace.sessions.push({ id: session.id, title: '', lastActiveAt: new Date().toISOString() }) // 加入侧栏摘要。
    await Promise.all([Store.save(session.id), Store.save('workspaces')]) // 同时落盘详情和索引。
    return session // 返回可立即发送消息的会话。
}

const update = async (id, patch) => {
    const session = Store.sessions[id] // 找到待修改的会话详情。
    if (!session) throw new Error('Session not found') // 不为不存在的 ID 创建隐式数据。

    if (patch.provider !== undefined) session.provider = patch.provider // 切换后续请求使用的提供商。
    if (patch.model !== undefined) session.model = patch.model // 切换后续请求使用的模型。

    const workspace = Store.workspaces[session.workspaceID] // 标题保存在工作区摘要中。
    const summary = workspace.sessions.find(item => item.id === id) // 定位侧栏中的同一会话。
    if (patch.title !== undefined) summary.title = patch.title // 只在明确提交标题时更新。
    summary.lastActiveAt = new Date().toISOString() // 所有修改都会刷新排序时间。

    await Promise.all([Store.save(id), Store.save('workspaces')]) // 保持详情和摘要同步。
    return session // 返回更新后的内存对象。
}

const remove = async id => {
    const runtime = Store.runtimes[id] // 取得需要终止的进程与审批。
    const session = Store.sessions[id] // 取得所属工作区和落盘目录。
    if (!runtime || !session) return false // 重复删除直接报告未发生变化。

    runtime.abortController.abort() // 先停止仍在使用会话的模型与工具。
    runtime.processes.forEach(process => process.kill()) // 防止后台命令继续写工作区。
    runtime.permission.values().forEach(resolve => resolve(false)) // 释放无限等待的审批 Promise。
    const workspace = Store.workspaces[session.workspaceID]
    workspace.sessions = workspace.sessions.filter(item => item.id !== id) // 从侧栏摘要移除。

    delete Store.sessions[id] // 让迟到的保存动作看不到已删除会话。
    delete Store.runtimes[id] // 让迟到的广播动作自动失效。
    await Store.save('workspaces') // 先保存不再引用该会话的索引。
    await rm(Path.session(id), { recursive: true, force: true }) // 最后清除磁盘历史。
    return true // 告知调用方删除完整完成。
}

const append = async (id, message) => {
    const session = Store.sessions[id] // 消息只能追加到现有会话。
    if (!session) throw new Error('Session not found') // 不隐式创建历史文件。

    session.messages.push(message) // 内存历史立即成为新的业务真相。
    await Store.save(id) // 同步重写可编辑 JSONL。
}

const rewrite = id => Store.save(id) // 外部改完明文消息后主动重写 JSONL。

const listen = id => {
    let controller // cancel 时用于移除同一个 SSE 客户端。
    return new ReadableStream({
        start(client) {
            const runtime = Store.runtimes[id] // 每个连接绑定一条会话运行态。
            if (!runtime) return client.error(new Error('Session not found')) // 删除后的连接立即失败。

            controller = client // 保存本次 ReadableStream 控制器。
            runtime.clients.add(client) // 后续广播直接推送到此连接。
            client.enqueue({
                type: 'data-session',
                data: { session: Store.sessions[id], status: runtime.status },
            })
            runtime.events.forEach(event => client.enqueue(event)) // 重放断线期间的本轮增量。

            if (runtime.status === 'idle') {
                runtime.clients.delete(client) // 空闲快照发送完就无需保持连接。
                client.close() // 结束本次有限事件流。
            }
        },
        cancel() {
            Store.runtimes[id]?.clients.delete(controller) // 浏览器断开后停止继续推送。
        },
    })
}

export default { read, create, update, remove, append, rewrite, listen } // 暴露完整会话业务入口。
