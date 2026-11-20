import { defineComponent, h } from 'vue'
import Ask from './Ask.vue'

export default app => {
    app.components.wrap('App', Original => defineComponent({
        setup: () => () => h('div', { style: 'height:100%;position:relative;' }, [h(Original), h(Ask, { app })]),
    }))
}
