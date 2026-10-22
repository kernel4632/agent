/*
消息收藏：后端没有收藏接口，所以只把用户主动收藏的消息快照存在浏览器本地。
会话 ID + 消息 ID 作为唯一键；删除会话或消息后仍然保留快照，方便以后查看。
调用示例：toggleFavorite({ sessionID, sessionTitle, message, role })
*/
import { reactive, watch } from 'vue'

const STORAGE_KEY = 'agent.messageFavorites.v1'
const MAX_ITEMS = 100

function load() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(value) ? value.filter(item => item && item.sessionID && item.messageID) : []
  } catch {
    return []
  }
}

export const Favorites = reactive({ items: load() })

watch(
  () => Favorites.items,
  items => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)))
    } catch {
      // 隐私模式或存储已满时收藏只在当前页面内生效，不阻断聊天。
    }
  },
  { deep: true },
)

export function favoriteKey(sessionID, messageID) {
  return `${sessionID}:${messageID}`
}

export function isFavorite(sessionID, messageID) {
  if (!sessionID || !messageID) return false
  return Favorites.items.some(item => item.key === favoriteKey(sessionID, messageID))
}

export function toggleFavorite({ sessionID, sessionTitle, message, role }) {
  const messageID = message?.id
  if (!sessionID || !messageID) return false
  const key = favoriteKey(sessionID, messageID)
  const index = Favorites.items.findIndex(item => item.key === key)
  if (index >= 0) {
    Favorites.items.splice(index, 1)
    return false
  }
  const text = String(message.content || message.reasoning || (message.tools || []).map(tool => tool.title || tool.name).join('、') || '').trim()
  Favorites.items.unshift({
    key,
    sessionID,
    sessionTitle: sessionTitle || '新会话',
    messageID,
    role,
    text: text.slice(0, 500),
    savedAt: Date.now(),
  })
  if (Favorites.items.length > MAX_ITEMS) Favorites.items.length = MAX_ITEMS
  return true
}

export function removeFavorite(key) {
  const index = Favorites.items.findIndex(item => item.key === key)
  if (index >= 0) Favorites.items.splice(index, 1)
}
