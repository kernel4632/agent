/*
会话：向壳登记「会话」入口、标签栏的 +，以及会话列表整页。
打开一条会话只是多一个标签并跳到 #/s/<id>；关掉标签不会删除会话。
*/

import { BubbleChatIcon, PlusSignIcon } from '@hugeicons/core-free-icons'
import Home from './Home.vue'

export default async app => {
    const shell = app.shell
    if (!shell) return

    const rename = shell.tabs.rename
    shell.tabs.rename = (id, title) => {
        rename(id, title)
        void app.api.op('session.rename', { id, title })
    }

    shell.bar.add({ id: 'home', place: 'start', icon: BubbleChatIcon, label: '会话', title: '全部会话', run: () => shell.go('#/') })
    shell.bar.add({
        id: 'new',
        place: 'tabs',
        icon: PlusSignIcon,
        label: '新会话',
        title: '新会话',
        run: async () => {
            const item = await app.api.op('session.create')
            shell.tabs.open(item.id, item.title)
        },
    })
    shell.pages.add({ id: 'home', title: '会话', component: Home })

    app.on('session.rename', data => {
        if (data?.id && data.title) rename(data.id, data.title)
    })

    await shell.tabs.restore(async id => {
        const list = await app.api.op('session.list')
        return list.find(item => item.id === id)
    })
}
