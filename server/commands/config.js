/*
配置指令集：读取和更新全局配置。
启动时由 server.js 从文件加载配置覆盖 store.config，本文件只负责运行时的读写操作。
调用示例：Config.get()、Config.update({ provider: { api: '...' } })。
*/
import { store } from '../store.js'                      // 引入配置数据
import { File } from '../utils/file.js'                  // 引入原子写文件能力


// --- 读取配置 ---
function get() {
  return store.config
}


// --- 更新配置 ---
async function update(partial = {}) {
  store.config = {
    provider: { ...store.config.provider, ...(partial.provider ?? {}) },
    prompts: { ...store.config.prompts, ...(partial.prompts ?? {}) },
    permission: { ...store.config.permission, ...(partial.permission ?? {}) },
    mcp: { ...store.config.mcp, ...(partial.mcp ?? {}) },
  }
  await File.write(store.paths.config, JSON.stringify(store.config, null, 2) + '\n')
  return store.config
}


// --- 从文件加载（server.js 启动时调用）---
async function load() {
  const file = Bun.file(store.paths.config)
  if (await file.exists()) store.config = await file.json()
  else await File.write(store.paths.config, JSON.stringify(store.config, null, 2) + '\n')
}


export const Config = { get, update, load }
