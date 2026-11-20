/*
设置：登记整页和顶栏右侧入口。不再包一层右侧抽屉，也不再往加号菜单里塞。
*/

import Page from './Page.vue'

export default app => {
    const shell = app.shell
    if (!shell) return
    shell.pages.add({ id: 'settings', title: '设置', component: Page })
    shell.bar.add({ id: 'settings', place: 'end', label: '设置', run: () => shell.go('#/settings') })
}
