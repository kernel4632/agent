/*
 * 上下文估算倍率的宿主缓存：agent-core 的 ratio 只在进程内校准，
 * 重启后第一次估算会退回默认 0.6。这里按 provider + model 记住最后一次
 * 真实 usage 学到的比例，创建 Agent 时作为 contextRatio 种子传回去。
 *
 * 只保存 source=usage 的值；host seed 或默认值不覆盖已经学到的真实比例。
 * 文件损坏、没权限都按“没有记录”处理，不影响会话启动。
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import Path from './path.js'

const keyOf = (provider, model) => `${String(provider || '')}\u0000${String(model || '')}`
let cache = null
let writeChain = Promise.resolve()

async function load() {
  if (cache) return cache
  try {
    const parsed = JSON.parse(await readFile(Path.contextRatios(), 'utf8'))
    cache = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

const validRatio = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 10

export async function read({ provider, model }) {
  if (!provider && !model) return null
  const data = await load()
  const entry = data[keyOf(provider, model)]
  if (!entry || !validRatio(entry.ratio) || entry.source !== 'usage') return null
  return { ratio: Number(entry.ratio), updatedAt: Number(entry.updatedAt) || 0 }
}

export async function remember({ provider, model, ratio, source }) {
  if ((!provider && !model) || source !== 'usage' || !validRatio(ratio)) return false
  const data = await load()
  const key = keyOf(provider, model)
  const current = data[key]
  const next = Number(ratio)
  // 同一比例不重复写盘；真实 usage 的新样本总是覆盖旧样本。
  if (current?.ratio === next && current?.source === 'usage') return false
  data[key] = { ratio: next, source: 'usage', updatedAt: Date.now() }
  cache = data
  const snapshot = JSON.stringify(data, null, 2)
  writeChain = writeChain.then(async () => {
    await mkdir(dirname(Path.contextRatios()), { recursive: true })
    await writeFile(Path.contextRatios(), snapshot)
  }).catch(() => {})
  return true
}

/** 测试/退出时等最后一次落盘。 */
export async function flush() {
  await writeChain
}

/** 测试用：丢掉内存缓存，下次重新读盘。 */
export function clear() {
  cache = null
}

export default { read, remember, flush, clear }
