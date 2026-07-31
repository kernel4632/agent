/*
Runtime 生命周期测试：在工具监听器已经启动后注入失败，确认启动失败不会遗留进程级资源。
调用方式：bun test server/test/runtime.test.js。
*/
import { describe, expect, it } from 'bun:test'               // 引入独立生命周期断言
import { mkdtemp } from 'node:fs/promises'                    // 引入真实临时数据目录
import { tmpdir } from 'node:os'                              // 引入系统临时目录
import { join } from 'node:path'                              // 引入跨平台路径拼接
import { Runtime } from '../runtime.js'                       // 引入真实运行时启动和关闭动作
import { store } from '../store.js'                           // 引入资源状态根供清理结果断言


describe('Runtime lifecycle', () => {
  it('rolls back resources when initialization fails after tool watching starts', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'agent-runtime-failure-')) // 为失败启动建立独立真实数据目录
    await expect(Runtime.start({
      dataDirectory,                                                     // 避免触碰用户实际配置
      lifecycle: { afterTools: async () => { throw new Error('injected startup failure') } }, // 在 watcher 已启动后注入可控错误
    })).rejects.toThrow('injected startup failure')                      // 启动必须保留原始失败原因
    expect(store.tools.watcher).toBeNull()                                // 失败回滚必须关闭文件监听器
    expect(store.capabilities.mcp.size).toBe(0)                           // 失败回滚不能留下 MCP 运行连接
    expect(store.capabilities.lsp.size).toBe(0)                           // 失败回滚不能留下 LSP 运行进程
  })
})
