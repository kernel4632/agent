/*
设置：登记整页（#/settings）、顶栏右侧的齿轮，以及自己负责的几类设置：模型供应商、默认模型、扩展。
别的扩展用 app.shell.pages.add({ id, parent: 'settings', title, description, icon, tone, group, order, component }) 加分类，
分类组件会收到 app / api / ui（设置控件）/ detail（地址里的详情段）/ nav（open 进详情、back 返回）。
不再有右侧抽屉，也不进加号菜单。
*/
import { AiBrain01Icon, Globe02Icon, PuzzleIcon, Settings02Icon } from '@hugeicons/core-free-icons'
import { css } from './ui.js'
import Page from './Page.vue'
import Form from './Form.vue'
import Providers from './Providers.vue'
import Extensions from './Extensions.vue'

export default app => {
    const shell = app.shell
    if (!shell) return
    app.style(css)
    shell.pages.add({ id: 'settings', title: '设置', component: Page })
    shell.bar.add({ id: 'settings', place: 'end', icon: Settings02Icon, label: '设置', title: '设置', run: () => shell.go('#/settings') })

    const group = '模型与服务'
    shell.pages.add({ id: 'providers', parent: 'settings', group, order: 10, tone: 'accent', icon: Globe02Icon, title: '模型供应商', description: '连接模型服务，管理地址、密钥和模型', component: Providers })
    shell.pages.add({ id: 'models', parent: 'settings', group, order: 20, tone: 'accent', icon: AiBrain01Icon, title: '默认模型', description: '新对话用哪个模型，压缩用哪个模型', component: Form, ids: ['models'] })
    shell.pages.add({ id: 'extensions', parent: 'settings', group: '系统', order: 90, icon: PuzzleIcon, title: '扩展', description: '开关内置和第三方扩展，查看加载状态', component: Extensions })
}
