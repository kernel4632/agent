/*
 * 技能管理：识别到的技能怎么启用、新建、改写和删除。
 *
 * 扫描和状态存放在 utils/skills.js；本文件只做用户能触发的动作和校验。
 * 外部目录里的技能只读：可以整目录启用，也可以复制内容到本应用目录后再改，但不会写别人的文件。
 *
 * 调用示例：
 *   await Skills.list({ cwd })                       // 生效技能 + 全部候选目录
 *   await Skills.save({ name, description, body })   // 新建或改写本应用的全局技能
 *   await Skills.toggle({ name, enabled, cwd })      // 只把某个技能从模型清单里拿掉
 *   await Skills.source({ path, enabled })           // 启用或停用一个外部技能目录
 */

import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { writeFile } from 'atomically'
import matter from 'gray-matter'
import fail from '../utils/fail.js'
import Skills from '../utils/skills.js'

// 技能名会变成文件夹名：允许各语言字母和数字，不允许路径分隔符。
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

const text = value => typeof value === 'string' ? value.trim() : ''

const validateName = value => {
    const name = text(value)
    if (!NAME.test(name)) throw fail(400, 'skill name must be 1-64 characters and cannot contain path separators')
    return name
}

const validateDescription = value => {
    const description = text(value)
    if (!description) throw fail(400, 'skill description is required')
    if (description.length > 500) throw fail(400, 'skill description must be at most 500 characters')
    return description
}

const validateBody = value => {
    if (value === undefined) return ''
    if (typeof value !== 'string') throw fail(400, 'skill body must be text')
    return value.trimEnd()
}

const validateScope = value => {
    const scope = value === undefined ? 'global' : value
    if (scope !== 'global' && scope !== 'project') throw fail(400, 'scope must be global or project')
    return scope
}

// Windows 的设备名不能当文件夹名，加个前缀避开。
const folderFor = name => RESERVED.test(name) ? `skill-${name}` : name

// --- 列出生效技能和识别到的目录 ---
const list = async ({ cwd = process.cwd(), extraRoots = [] } = {}) => Skills.list({ cwd, extraRoots })

// --- 读一个技能的正文 ---
const read = async ({ name, cwd = process.cwd() } = {}) => {
    if (typeof name !== 'string' || !name.trim()) throw fail(400, 'skill name is required')
    return Skills.read({ name: name.trim(), cwd })
}

// --- 新建或改写本应用自己的技能 ---
const save = async ({ name, description, body = '', cwd = process.cwd(), scope = 'global' } = {}) => {
    const skillName = validateName(name)
    const summary = validateDescription(description)
    const content = validateBody(body)
    const targetScope = validateScope(scope)
    if (typeof cwd !== 'string' || !cwd.trim()) throw fail(400, 'cwd must be a directory path')
    if (targetScope === 'project' && !(await Skills.isDirectory(cwd))) throw fail(400, `folder does not exist: ${cwd}`)

    const { root, skill } = await Skills.findOwn({ name: skillName, cwd, scope: targetScope })
    let directory = skill?.directory
    if (!directory) {
        // 同名文件夹可能属于另一个技能，换一个后缀，不能覆盖别人的 SKILL.md。
        const base = folderFor(skillName)
        directory = join(root, base)
        let index = 2
        while (await Skills.isDirectory(directory)) directory = join(root, `${base}-${index++}`)
    }

    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), matter.stringify(`${content}\n`, { name: skillName, description: summary }))

    const saved = await Skills.findOwn({ name: skillName, cwd, scope: targetScope })
    if (!saved.skill) throw fail(500, `skill was written but cannot be read back: ${skillName}`)
    return { ...saved.skill, enabled: true }
}

// --- 删除本应用自己的技能；外部目录和项目目录以外的文件一律不动 ---
const remove = async ({ name, cwd = process.cwd(), scope = 'global' } = {}) => {
    const skillName = validateName(name)
    const targetScope = validateScope(scope)
    const { root, skill } = await Skills.findOwn({ name: skillName, cwd, scope: targetScope })
    if (!skill) throw fail(404, `Skill not found: ${skillName}`)
    if (!Skills.inside(root, skill.directory) || resolve(skill.directory) === resolve(root)) {
        throw fail(400, 'refusing to delete a skill folder outside its own directory')
    }

    await rm(skill.directory, { recursive: true, force: false })
    await Skills.setDisabled({ name: skillName, disabled: false })
    return { ok: true, name: skillName }
}

// --- 把技能从模型清单里拿掉或放回来；文件留在磁盘上 ---
const toggle = async ({ name, enabled, cwd = process.cwd() } = {}) => {
    if (typeof name !== 'string' || !name.trim()) throw fail(400, 'skill name is required')
    if (typeof enabled !== 'boolean') throw fail(400, 'enabled must be true or false')
    const { skills } = await Skills.list({ cwd })
    if (!skills.some(skill => skill.name === name.trim())) throw fail(404, `Skill not found: ${name}`)
    return Skills.setDisabled({ name: name.trim(), disabled: !enabled })
}

// --- 启用或停用一个外部技能目录 ---
const source = async ({ path, enabled } = {}) => {
    if (typeof path !== 'string' || !path.trim()) throw fail(400, 'source path is required')
    if (typeof enabled !== 'boolean') throw fail(400, 'enabled must be true or false')
    const target = resolve(path.trim())
    if (await Skills.isOwnPath(target)) throw fail(400, 'the application skill folders are always enabled')

    if (enabled) {
        if (!(await Skills.isDirectory(target))) throw fail(400, `folder does not exist: ${target}`)
        const root = { id: 'source', label: target, app: '外部目录', path: target, scope: 'global', kind: 'source', editable: false }
        const found = await Skills.scan(target, root, { preview: true })
        if (!found.length) throw fail(400, 'no usable skills found in this folder')
    }

    await Skills.setSource({ path: target, enabled })
    return { path: target, enabled }
}

export default { list, read, save, remove, toggle, source }
