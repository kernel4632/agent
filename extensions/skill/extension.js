/*
 * skill 扩展声明：技能系统的前后端入口。
 *
 * 结构：
 *   extensions/skill/
 *     extension.js       ← 本文件，声明扩展 id 和前后端入口
 *     backend.js         ← 后端：patch Tool.build/kind/list，注册 skill.* op
 *     frontend/index.js  ← 前端：注册设置页和工具结果视图
 *     skills.js          ← 技能扫描逻辑
 *     tool.js            ← skill 工具定义
 */

export default {
    id: 'skill',
    requires: [],
    backend: './backend.js',
    frontend: './frontend/index.js',
}
