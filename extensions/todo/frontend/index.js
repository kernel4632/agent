/*
任务清单：挂在对话顶栏右侧的清单图标，不进加号菜单。点开后在对话右侧显示，手机上是整屏页。
*/
import { CheckListIcon } from '@hugeicons/core-free-icons'
import Panel from './Panel.vue'

export default app => {
    app.shell?.header.add({ id: 'todo', icon: CheckListIcon, label: '任务', title: '任务清单', component: Panel })
}
