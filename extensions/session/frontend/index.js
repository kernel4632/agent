/*
会话前端：用 Shell 包住 App，侧栏挂多个 Agent。标题变更（自动或手动）时刷新列表。
*/

import { defineComponent, h } from 'vue'
import Shell from './Shell.vue'

export default app => {
    app.components.wrap('App', Original => defineComponent({
        setup: () => () => h(Shell, { app, original: Original }),
    }))
    app.plus.add({ id: 'session-new', label: '新会话', run: async () => {
        const item = await app.api.op('session.create')
        location.hash = `#/s/${item.id}`
    } })
}
