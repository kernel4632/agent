/*
 * 输入区草稿：按会话把文字和待发送图片持久化到 IndexedDB。
 * 刷新/重启前端后，打开同一条会话仍能恢复未发送内容。
 *
 * 不能只放 localStorage：粘贴的截图和附件是 data URL，很容易超过 5MB 配额。
 * IndexedDB 支持结构化克隆和大字段；不可用时退回 localStorage，至少保住文字。
 *
 * 调用示例：
 *   await ComposerDraft.hydrate(session)
 *   await ComposerDraft.save(session.id, { text, files })
 *   await ComposerDraft.remove(session.id)
 */

const DB_NAME = 'agent-composer-drafts'
const STORE = 'drafts'
const FALLBACK_PREFIX = 'agent.composer-draft:'
let database = null

function hasIndexedDB() {
  return typeof indexedDB !== 'undefined'
}

function openDatabase() {
  if (database) return database
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开草稿存储'))
    request.onblocked = () => reject(new Error('草稿存储被其他页面占用'))
  })
  return database
}

function fallbackKey(sessionID) {
  return `${FALLBACK_PREFIX}${sessionID}`
}

function readFallback(sessionID) {
  try {
    const value = JSON.parse(localStorage.getItem(fallbackKey(sessionID)) || 'null')
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

function writeFallback(sessionID, value) {
  try {
    if (value) localStorage.setItem(fallbackKey(sessionID), JSON.stringify(value))
    else localStorage.removeItem(fallbackKey(sessionID))
  } catch {
    // 配额不足时不能影响输入；图片仍可在当前会话使用到发送为止。
  }
}

// Vue 响应式对象不能直接结构化克隆，转成普通对象再存。
function plainFiles(files = []) {
  return files.map(file => ({ ...file }))
}

function payload({ text = '', files = [] } = {}) {
  return {
    text: String(text || ''),
    files: plainFiles(files),
    updatedAt: Date.now(),
  }
}

function isEmpty(value) {
  return !value || (!String(value.text || '').trim() && !(value.files || []).length)
}

export async function read(sessionID) {
  if (!sessionID) return null
  if (!hasIndexedDB()) return readFallback(sessionID)
  try {
    const db = await openDatabase()
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(sessionID)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return readFallback(sessionID)
  }
}

export async function save(sessionID, value) {
  if (!sessionID) return false
  const data = payload(value)
  if (!hasIndexedDB()) {
    writeFallback(sessionID, isEmpty(data) ? null : data)
    return true
  }
  try {
    const db = await openDatabase()
    await new Promise((resolve, reject) => {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
      const request = isEmpty(data) ? store.delete(sessionID) : store.put(data, sessionID)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    // 从 IndexedDB 成功写过后清掉旧 fallback，避免以后 IDB 不可用时读到过期内容。
    writeFallback(sessionID, null)
    return true
  } catch {
    writeFallback(sessionID, isEmpty(data) ? null : data)
    return false
  }
}

export async function remove(sessionID) {
  if (!sessionID) return
  writeFallback(sessionID, null)
  if (!hasIndexedDB()) return
  try {
    const db = await openDatabase()
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(sessionID)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch {
    // 删除失败不影响当前页面，下一次 save 会覆盖。
  }
}

/**
 * 页面重新打开时恢复：只填空会话，绝不覆盖用户已经输入的内容。
 * 无论存储是否可用，都把 draftLoaded 标上，后续 watcher 才会开始持久化。
 */
export async function hydrate(session) {
  if (!session?.id || session.draftLoaded) return session
  const stored = await read(session.id)
  const hasCurrent = Boolean(String(session.draft || '').trim() || (session.files || []).length)
  if (stored && !hasCurrent) {
    session.draft = String(stored.text || '')
    session.files = Array.isArray(stored.files) ? stored.files : []
  }
  session.draftLoaded = true
  return session
}

export const ComposerDraft = { read, save, remove, hydrate }
