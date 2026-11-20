import Panel from './Panel.vue'
export default app => {
    app.panels.add({ id: 'skill', title: '技能', component: Panel })
    app.plus.add({ id: 'skill', label: '技能', run: () => app.shared.openPanel?.('skill') })
}
