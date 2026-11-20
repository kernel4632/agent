/*
权限：询问条画在壳的内容浮层里（对话上方），不另外包一层 App；规则是设置页里的「权限」分类，一行一个工具。
*/
import { Shield01Icon } from '@hugeicons/core-free-icons'
import Ask from './Ask.vue'
import Rules from './Rules.vue'

export default app => {
    app.shell?.overlay.add({ id: 'permission', component: Ask })
    app.shell?.pages.add({ id: 'permission', parent: 'settings', group: '安全', order: 50, tone: 'warn', icon: Shield01Icon, title: '权限', description: '哪些工具直接执行、哪些先问你', component: Rules })
}
