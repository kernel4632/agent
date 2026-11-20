import Panel from './Panel.vue'

export default app => {
    app.shell?.pages.add({ id: 'skill', title: '技能', parent: 'settings', component: Panel })
}
