/*
权限询问画在壳的内容浮层里，不另外包一层 App。规则仍在设置页的「权限」分类。
*/
import Ask from './Ask.vue'

export default app => {
    app.shell?.overlay.add({ id: 'permission', component: Ask })
}
