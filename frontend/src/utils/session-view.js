/*
 * 浏览器本地的“上次位置”：刷新后恢复打开的会话和滚动位置。
 * 只读写 localStorage，不依赖 Vue、store 或网络；调用方负责传入会话 ID。
 */
const PATH_KEY = 'agent.session-path'
const SCROLL_PREFIX = 'agent.session-scroll.'

function readJSON(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null // 损坏或浏览器禁用存储时按“没保存过”处理
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* 隐私模式或配额满时静默忽略，不影响当前页面 */ }
}

export function readPath() {
  const value = readJSON(PATH_KEY)
  if (value?.view === 'home') return { view: 'home' }
  if (value?.view === 'chat' && typeof value.sessionId === 'string' && value.sessionId) {
    return { view: 'chat', sessionId: value.sessionId }
  }
  return null
}

export function savePath(path) {
  if (path?.view === 'home') writeJSON(PATH_KEY, { view: 'home' })
  else if (path?.view === 'chat' && path.sessionId) writeJSON(PATH_KEY, { view: 'chat', sessionId: path.sessionId })
}

export function readScroll(sessionID) {
  if (!sessionID) return null
  const value = readJSON(`${SCROLL_PREFIX}${sessionID}`)
  if (!value || !Number.isFinite(value.top)) return null
  return {
    top: Math.max(0, value.top),
    visibleStart: Number.isInteger(value.visibleStart) ? Math.max(0, value.visibleStart) : null,
    pinned: Boolean(value.pinned),
  }
}

export function saveScroll(sessionID, scroll) {
  if (!sessionID || !Number.isFinite(scroll?.top)) return
  writeJSON(`${SCROLL_PREFIX}${sessionID}`, {
    top: Math.max(0, scroll.top),
    visibleStart: Number.isInteger(scroll.visibleStart) ? Math.max(0, scroll.visibleStart) : 0,
    pinned: Boolean(scroll.pinned),
  })
}

export function clearScroll(sessionID) {
  if (!sessionID) return
  try {
    localStorage.removeItem(`${SCROLL_PREFIX}${sessionID}`)
  } catch { /* 存储不可用时无需清理 */ }
}
