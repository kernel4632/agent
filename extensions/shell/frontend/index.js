/*
顶部栏扩展：包住 App，露出 app.shell。自己不创建会话、不画设置表单。
其他扩展通过 app.shell.tabs / header / pages / bar / overlay 往壳上登记。
*/

import { defineComponent, h, onMounted, onUnmounted } from 'vue'
import { create } from './api.js'
import Chrome from './Chrome.vue'

export default app => {
    const shell = create(app)
    app.shared.shell = shell
    let stop = () => {}
    app.components.wrap('App', Original => defineComponent({
        setup() {
            onMounted(() => { stop = shell.listen() })
            onUnmounted(() => stop())
            return () => h(Chrome, { shell, original: Original, app })
        },
    }))
}
