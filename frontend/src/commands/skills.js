/*
 * 技能页的数据操作：加载生效技能和候选目录，保存、删除、启停。
 *
 * 组件只负责展示和本地交互；cwd 取当前会话的目录，没有会话时让后端用自己的当前目录。
 * 请求失败统一交给 Notice，返回 null 表示这次动作没有结果。
 * 调用示例：
 *   const data = await Skills.load()
 *   await Skills.save({ name, description, body, scope: 'global' })
 *   await Skills.source('/home/me/.claude/skills', true)
 */

import { AgentAPI } from '../utils/api.js'
import { store } from '../store.js'
import { Notice } from './notice.js'

const cwd = () => store.sessions[store.ui.activeSessionID]?.cwd || ''

async function run(action) {
  try {
    return await action()
  } catch (error) {
    Notice.show(error.message)
    return null
  }
}

const load = () => run(() => AgentAPI.getSkills(cwd()))
const read = name => run(() => AgentAPI.readSkill(name, cwd()))
const save = skill => run(() => AgentAPI.saveSkill({ ...skill, cwd: cwd() }))
const remove = (name, scope = 'global') => run(() => AgentAPI.removeSkill({ name, scope, cwd: cwd() }))
const toggle = (name, enabled) => run(() => AgentAPI.toggleSkill({ name, enabled, cwd: cwd() }))
const source = (path, enabled) => run(() => AgentAPI.toggleSkillSource({ path, enabled }))

// --- 识别到但还不生效的外部目录；本应用自己的目录已经在技能清单里，不重复展示 ---
const externalRoots = roots => (roots || []).filter(root => root.kind !== 'own' && root.exists)

// --- 外部目录里的技能在正文弹窗里标记来源；本应用的技能可以直接改 ---
const sourceLabel = skill => skill.editable ? '本应用' : (skill.app || '外部目录')

export const Skills = { load, read, save, remove, toggle, source, cwd }
export { externalRoots, sourceLabel }
