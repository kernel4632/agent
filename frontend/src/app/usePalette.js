/*
命令面板数据：管理面板开关和可执行的命令项。
导航和会话读取仍走传入的动作，这里只负责列表、开关和关闭后执行，不复制业务逻辑。
调用示例：
  const { open: paletteOpen, items: paletteItems, openPalette, closePalette, run: runPalette } =
    usePalette({ openDraft, goHome, openSession })
*/
import { computed, ref } from 'vue'
import { store } from '../store.js'
import { UI } from '../commands/ui.js'

export function usePalette({ openDraft, goHome, openSession }) {
  const open = ref(false)                                           // 面板是否显示

  // 固定命令在前，所有工作区的会话追加在后；搜索和键盘交互由 CommandPalette 处理。
  const items = computed(() => {
    const list = [
      { id: 'new', label: '新建会话', hint: 'N', run: openDraft },
      { id: 'home', label: '主页', hint: '', run: goHome },
      { id: 'settings', label: '设置', hint: 'Ctrl ,', run: () => UI.openSettings() },
    ]
    for (const workspace of store.workspaces) {
      for (const item of workspace.sessions || []) {
        list.push({ id: `session:${item.id}`, label: item.title || '新会话', hint: workspace.name, run: () => openSession(item.id) })
      }
    }
    return list
  })

  function openPalette() { open.value = true }

  function closePalette() { open.value = false }

  // 选中后先关面板，再执行该项携带的动作，避免动作切换页面时面板还压在上面。
  function run(item) {
    closePalette()
    void item?.run?.()
  }

  return { open, items, openPalette, closePalette, run }
}
