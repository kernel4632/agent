import { store } from '../store.js'

// The server has no workspace or session-list API. This is only a browser index,
// not a server workspace, filesystem permission boundary, or history backup.
export const SESSION_INDEX_KEY = 'la.session-index.v1'

async function load() {
  let sessions = []
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_INDEX_KEY) || '[]')
    if (Array.isArray(saved)) sessions = saved.filter(item => item && typeof item.id === 'string' && /^[\w-]+$/.test(item.id))
  } catch { /* An invalid local index does not prevent opening the application. */ }
  store.workspaces.splice(0, store.workspaces.length, { id: 'local', name: '本机会话', path: '当前浏览器的会话索引', sessions })
  store.ui.activeWorkspaceID = 'local'
  return true
}

export const Workspace = { load }
