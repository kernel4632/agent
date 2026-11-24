/*
技能：不进加号菜单，作为设置页「能力」组里的一个分类（#/settings/skill），一行一个技能、带开关。
*/
import { BookOpen01Icon } from '@hugeicons/core-free-icons'
import Panel from './Panel.vue'

/** @param {import('agent-extension').App} app */
export default app => {
    app.shell?.pages.add({ id: 'skill', parent: 'settings', group: '能力', order: 40, tone: 'success', icon: BookOpen01Icon, title: '技能', description: '按需读取的操作说明，可逐个开关', component: Panel })
}
