/*
 * skill 扩展前端入口：往框架注入技能设置页和工具结果视图。
 *
 * app.ui 和 app.vue 由框架传入，不能 import，从参数取。
 * @app/ 在打包时会被替换成框架里的实际路径。
 */

import SkillList from './SkillList.vue'

export default function (app) {
    // 注册技能设置页
    app.settings.add({
        id: 'skills',
        label: '技能',
        description: '识别并管理本机的操作说明',
        icon: 'idea',
        group: '模型与服务',
        tone: 'tertiary',
        component: SkillList,
    })
}
