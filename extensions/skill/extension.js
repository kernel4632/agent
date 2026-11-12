/*
 * skill 扩展声明：技能系统的前后端入口。扩展的身份就是文件夹名 skill。
 *
 *   extensions/skill/
 *     extension.js       ← 本文件
 *     backend.js         ← 后端：patch Tool.build/kind/list，注册 skill.* op
 *     frontend/index.js  ← 前端：注册技能设置页
 *     skills.js / tool.js ← 技能扫描逻辑和 skill 工具定义
 */

export default {
    name: '技能',
    description: '读取 SKILL.md 操作说明，提供 skill 工具和技能设置页',
    version: '1.0.0',
    requires: [],
    backend: './backend.js',
    frontend: './frontend/index.js',
}
