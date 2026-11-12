/*
 * todo 扩展前端：注册右侧任务清单面板、顶栏按钮、工具结果视图。
 *
 * app 由框架传入，Dialog/Icon 从 __agentApp__ 取。
 */

import TaskPanel from './TaskPanel.vue'
import { latestTodos } from './utils.js'

export default function (app) {
    const { ref, computed, watch } = app.vue
    const store = app.shared['store.js'].store

    // 获取当前会话
    const session = computed(() => store.ui.view === 'chat' && store.ui.activeSessionID 
        ? store.sessions[store.ui.activeSessionID] 
        : null)

    // 当前会话的任务清单
    const todos = computed(() => {
        if (!session.value) return []
        const latest = latestTodos(session.value.messages || [])
        return latest.length ? latest : session.value.todos || []
    })

    // 任务清单面板是否打开
    const todoOpen = ref(false)

    // 有任务时才显示顶栏按钮
    const hasTodos = computed(() => todos.value.length > 0)

    // 切换会话时，如果新会话没有任务就关掉面板
    watch(() => session.value?.id, () => {
        if (!hasTodos.value) todoOpen.value = false
    })

    // 注册右侧面板
    app.panels.add({
        id: 'todo',
        component: TaskPanel,
        props: computed(() => ({
            open: todoOpen.value,
            todos: todos.value,
            session: session.value,
            'onUpdate:open': value => { todoOpen.value = value },
            Dialog: app.shared['ui/Dialog.vue'].default,
            Icon: app.shared['ui/Icon.vue'].default,
        })),
    })

    // 注册顶栏按钮
    app.topbar.add({
        id: 'todo',
        icon: computed(() => todoOpen.value ? 'close' : 'todo'),
        label: '任务清单',
        active: todoOpen,
        onClick: () => { todoOpen.value = !todoOpen.value },
        visible: hasTodos,
    })
}
