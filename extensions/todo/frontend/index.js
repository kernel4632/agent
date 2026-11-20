/*
任务清单：挂在对话顶栏，不进加号菜单。点开后在对话右侧显示。
*/
import Panel from './Panel.vue'

export default app => {
    app.shell?.header.add({ id: 'todo', label: '任务', title: '任务清单', component: Panel })
}
