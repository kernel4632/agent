/*
 * Mermaid 渲染结果持久缓存：SVG 生成一次后写入 IndexedDB，下次打开会话直接取。
 * key 里带主题，因为 SVG 的配色是渲染时烧进去的具体色值；主题切换不能复用另一套颜色。
 * 只缓存成功结果；失败/语法错误仍每次按现场源码重试。
 */

const DB_NAME = 'agent-mermaid-cache'
const STORE = 'diagrams'
const VERSION = 1
const MAX_ENTRIES = 300
const PREFIX = `v${VERSION}\u0000`
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
    request.onerror = () => reject(request.error || new Error('无法打开图表缓存'))
    request.onblocked = () => reject(new Error('图表缓存被其他页面占用'))
  })
  return database
}

export async function read(key) {
  if (!hasIndexedDB() || !key) return null
  try {
    const db = await openDatabase()
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(`${PREFIX}${key}`)
      request.onsuccess = () => resolve(request.result?.svg ? request.result : null)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return null
  }
}

export async function write(key, result) {
  if (!hasIndexedDB() || !key || !result?.svg) return false
  try {
    const db = await openDatabase()
    await new Promise((resolve, reject) => {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
      const request = store.put({ svg: result.svg, updatedAt: Date.now() }, `${PREFIX}${key}`)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    void prune(db)
    return true
  } catch {
    return false
  }
}

async function prune(db) {
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    const count = await new Promise((resolve, reject) => {
      const request = store.count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (count <= MAX_ENTRIES) return
    let remaining = count - MAX_ENTRIES
    await new Promise((resolve, reject) => {
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor || remaining <= 0) return resolve()
        cursor.delete()
        remaining -= 1
        cursor.continue()
      }
      request.onerror = () => reject(request.error)
    })
  } catch {
    // 配额或事务失败不影响当前渲染。
  }
}
