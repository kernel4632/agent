/*
全局快捷键：把 window keydown 翻译成命令面板、设置、停止生成和新建会话动作。
除动作外传入的都是状态读取函数，避免这里缓存会随页面变化的值；返回可直接注册和移除的处理器。
调用示例：
  const shortcuts = createShortcutHandler({
    paletteOpen: () => paletteOpen.value, openPalette, closePalette,
    openSettings: UI.openSettings, isSettingsOpen: () => store.ui.settingsOpen, closeSettings: UI.closeSettings,
    session: () => session.value, stopSession: id => Chat.stop(id), newConversation: openDraft,
  })
  window.addEventListener('keydown', shortcuts)
*/
export function createShortcutHandler({
  paletteOpen,
  openPalette,
  closePalette,
  openSettings,
  isSettingsOpen,
  closeSettings,
  session,
  stopSession,
  newConversation,
}) {
  return function shortcuts(event) {
    // 任何原生 dialog 打开时都让给它自己处理键盘，避免 Esc 同时关两处。
    if (document.querySelector('dialog[open]')) return

    // 命令面板打开时只接管 Esc，其余按键留给面板内部。
    if (paletteOpen()) {
      if (event.key === 'Escape') closePalette()
      return
    }

    // Ctrl/Cmd+K 或 Ctrl/Cmd+P 打开命令面板。
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'p')) {
      event.preventDefault()
      void openPalette()
      return
    }

    // Ctrl/Cmd+, 打开设置。
    if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault()
      openSettings()
      return
    }

    // Esc 优先关闭设置；否则在会话运行中停止生成。
    if (event.key === 'Escape') {
      if (isSettingsOpen()) { event.preventDefault(); void closeSettings(); return }
      const current = session()
      if (current?.status === 'running') stopSession(current.id)
      return
    }

    // 单按 N 新建会话；输入框、下拉框和可编辑区域内不触发。
    if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && !event.target.closest('input,textarea,select,[contenteditable]')) void newConversation()
  }
}
