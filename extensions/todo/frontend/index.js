import Panel from './Panel.vue'

export default app => {
    app.panels.add({ id: 'todo', title: '任务清单', component: Panel })
    app.plus.add({ id: 'todo', label: '任务清单', run: () => app.shared.openPanel?.('todo') })
}
