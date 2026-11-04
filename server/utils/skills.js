/*
 * 技能目录：确定技能放在哪里、读一份技能的元数据、记住用户启用了哪些外部目录。
 *
 * 技能来源有三类：
 *   - 应用自己的全局目录（数据目录的 skills/）和会话当前目录下的 .agent/skills
 *   - 其他 Agent 软件留下的技能目录（只识别，用户启用后才参与技能清单）
 *   - 用户手动添加的任意技能目录（存在 skills.json 的 sources 里）
 * 启用的外部目录和单独禁用的技能名保存在数据目录的 skills.json：
 *   { "sources": ["D:/other/skills"], "disabled": ["review"] }
 * 扫描规则只在这里实现，tools/skill.js 和 features/skills.js 共用同一份。
 *
 * 调用示例：
 *   const { skills, roots } = await Skills.list({ cwd })
 *   const skill = await Skills.read({ name: 'review', cwd })
 *   const { root, skill } = await Skills.findOwn({ name: 'review', cwd })
 */

import { mkdir, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { writeFile } from 'atomically'
import matter from 'gray-matter'
import Path from './path.js'
import fail from './fail.js'

const MAX_SKILLS = 200                 // 一个目录最多收这么多技能，防止有人把大仓库指进来
const MAX_BYTES = 256 * 1024           // 一份 SKILL.md 的上限
const PREVIEW_BYTES = 4096             // 只列清单时读前面这一段就够了

// --- 路径比较：Windows 不区分大小写 ---
const normal = value => resolve(String(value))
const samePath = (first, second) => process.platform === 'win32'
    ? normal(first).toLowerCase() === normal(second).toLowerCase()
    : normal(first) === normal(second)
const inside = (root, target) => {
    const base = normal(root)
    const path = normal(target)
    return path === base || path.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)
}

// --- 目录存在才算来源，坏路径不报错，当作没有 ---
const isDirectory = async path => {
    try {
        return (await stat(path)).isDirectory()
    } catch {
        return false
    }
}

// --- 技能目录状态：外部目录和禁用名单 ---
const textList = value => Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
    : []

const normalizeState = raw => ({
    sources: [...new Set(textList(raw?.sources).map(item => normal(item)))],
    disabled: [...new Set(textList(raw?.disabled))],
})

const emptyState = () => ({ sources: [], disabled: [] })

const state = async () => {
    try {
        const file = Bun.file(Path.skillsState())
        if (!(await file.exists())) return emptyState()
        return normalizeState(await file.json())
    } catch {
        // 状态文件坏了就按默认处理，技能本身还在磁盘上，不会因此消失。
        return emptyState()
    }
}

const saveState = async value => {
    const next = normalizeState(value)
    await mkdir(dirname(Path.skillsState()), { recursive: true })
    await writeFile(Path.skillsState(), JSON.stringify(next, null, 2))
    return next
}

// --- 单独禁用一个技能：只影响交给模型的清单，文件不动 ---
const setDisabled = async ({ name, disabled }) => {
    const current = await state()
    const names = new Set(current.disabled)
    if (disabled) names.add(name)
    else names.delete(name)
    await saveState({ ...current, disabled: [...names] })
    return { name, enabled: !disabled }
}

// --- 启用或停用一个外部技能目录 ---
const setSource = async ({ path, enabled }) => {
    const current = await state()
    const target = normal(path)
    const sources = current.sources.filter(item => !samePath(item, target))
    if (enabled) sources.push(target)
    await saveState({ ...current, sources })
    return { path: target, enabled }
}

/*
 * 已知的技能目录：应用自己的两处在前，后面是常见 Agent 软件留下的位置。
 * 这里只给候选，是否存在、有没有技能由 describe 判断。
 */
const candidates = ({ cwd = process.cwd() } = {}) => {
    const home = Path.userHome()
    const configHome = process.env.XDG_CONFIG_HOME || join(home, '.config')
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming')
    return [
        { id: 'own', label: '本应用', app: 'Agent', path: Path.skills(), scope: 'global', kind: 'own' },
        { id: 'own-project', label: '当前目录', app: 'Agent', path: Path.projectSkills(cwd), scope: 'project', kind: 'own' },
        { id: 'claude', label: 'Claude Code', app: 'Claude Code', path: join(home, '.claude', 'skills'), scope: 'global', kind: 'app' },
        { id: 'claude-project', label: 'Claude Code（当前目录）', app: 'Claude Code', path: join(cwd, '.claude', 'skills'), scope: 'project', kind: 'app' },
        { id: 'codex', label: 'Codex', app: 'Codex', path: join(home, '.codex', 'skills'), scope: 'global', kind: 'app' },
        { id: 'codex-project', label: 'Codex（当前目录）', app: 'Codex', path: join(cwd, '.codex', 'skills'), scope: 'project', kind: 'app' },
        { id: 'gemini', label: 'Gemini CLI', app: 'Gemini CLI', path: join(home, '.gemini', 'skills'), scope: 'global', kind: 'app' },
        { id: 'gemini-project', label: 'Gemini CLI（当前目录）', app: 'Gemini CLI', path: join(cwd, '.gemini', 'skills'), scope: 'project', kind: 'app' },
        { id: 'opencode', label: 'opencode', app: 'opencode', path: join(configHome, 'opencode', 'skill'), scope: 'global', kind: 'app' },
        { id: 'opencode-windows', label: 'opencode', app: 'opencode', path: join(appData, 'opencode', 'skill'), scope: 'global', kind: 'app' },
        { id: 'cursor', label: 'Cursor', app: 'Cursor', path: join(home, '.cursor', 'skills'), scope: 'global', kind: 'app' },
        { id: 'cursor-project', label: 'Cursor（当前目录）', app: 'Cursor', path: join(cwd, '.cursor', 'skills'), scope: 'project', kind: 'app' },
    ]
}

// --- 读一份 SKILL.md；缺名字或说明的坏文件直接跳过 ---
const readFile = async (file, root, preview) => {
    try {
        const handle = Bun.file(file)
        if (!(await handle.exists()) || handle.size > MAX_BYTES) return null
        const text = preview ? await handle.slice(0, PREVIEW_BYTES).text() : await handle.text()
        const { data, content } = matter(text)
        const name = typeof data.name === 'string' ? data.name.trim() : ''
        const description = typeof data.description === 'string' ? data.description.trim() : ''
        if (!name || !description) return null
        const path = normal(file)
        return {
            name,
            description,
            body: preview ? '' : content.trim(),
            path,
            directory: dirname(path),
            source: root.id,
            sourceLabel: root.label,
            app: root.app,
            scope: root.scope,
            kind: root.kind,
            editable: Boolean(root.editable),
        }
    } catch {
        return null
    }
}

// --- 扫描一个目录：支持目录本身是一个技能，也支持下面一层每个文件夹一个技能 ---
const scan = async (path, root, { preview = false } = {}) => {
    if (!(await isDirectory(path))) return []
    const files = [join(path, 'SKILL.md')]
    try {
        for await (const file of new Bun.Glob('*/SKILL.md').scan({ cwd: path })) files.push(join(path, file))
        files.sort()
    } catch {
        // 目录读不了时只保留目录本身那一次尝试。
    }

    const skills = new Map()
    for (const file of files) {
        if (skills.size >= MAX_SKILLS) break
        const skill = await readFile(file, root, preview)
        if (skill && !skills.has(skill.name)) skills.set(skill.name, skill)
    }
    return [...skills.values()]
}

// --- 同名技能的覆盖顺序：外部全局 → 外部项目 → 本应用全局 → 本项目 ---
const rank = root => root.kind === 'own'
    ? (root.scope === 'project' ? 3 : 2)
    : (root.scope === 'project' ? 1 : 0)

// --- 描述全部候选目录：是否存在、是否启用、里面有几个技能 ---
const describe = async ({ cwd, saved }) => {
    const known = candidates({ cwd })
    const extra = saved.sources
        .filter(path => !known.some(root => samePath(root.path, path)))
        .map((path, index) => ({
            id: `extra-${index + 1}`,
            label: basename(path) || path,
            app: '外部目录',
            path,
            scope: 'global',
            kind: 'source',
            editable: false,
        }))

    const roots = []
    for (const root of [...known, ...extra]) {
        const exists = await isDirectory(root.path)
        const enabled = root.kind === 'own' ? true : saved.sources.some(path => samePath(path, root.path))
        const found = exists ? await scan(root.path, root, { preview: true }) : []
        roots.push({
            id: root.id,
            label: root.label,
            app: root.app,
            path: normal(root.path),
            scope: root.scope,
            kind: root.kind,
            editable: root.kind === 'own',
            enabled,
            exists,
            skillCount: found.length,
            skills: found.map(skill => skill.name).slice(0, 20),
        })
    }
    return roots.sort((first, second) => rank(first) - rank(second) || first.label.localeCompare(second.label))
}

// --- 当前生效的技能：外部目录 → 本应用全局 → 项目目录，后者覆盖同名项 ---
const list = async ({ cwd = process.cwd(), includeDisabled = true } = {}) => {
    const saved = await state()
    const roots = await describe({ cwd, saved })
    const skills = new Map()
    for (const root of roots) {
        if (!root.exists || !root.enabled) continue
        for (const skill of await scan(root.path, root)) skills.set(skill.name, skill)
    }

    const found = [...skills.values()]
        .map(skill => ({ ...skill, enabled: !saved.disabled.includes(skill.name) }))
        .sort((first, second) => first.name.localeCompare(second.name))
    return {
        skills: includeDisabled ? found : found.filter(skill => skill.enabled),
        roots,
        state: saved,
    }
}

// --- 按名字取一个技能；禁用中的技能也能读到，管理页要能重新打开 ---
const read = async ({ name, cwd = process.cwd(), includeDisabled = true } = {}) => {
    if (typeof name !== 'string' || !name.trim()) throw fail(400, 'skill name is required')
    const { skills } = await list({ cwd, includeDisabled })
    const skill = skills.find(item => item.name === name)
    if (!skill) throw fail(404, `Skill not found: ${name}`)
    return skill
}

// --- 可写目录：全局技能目录，或当前目录的项目技能目录 ---
const ownRoot = ({ cwd = process.cwd(), scope = 'global' } = {}) => scope === 'project'
    ? Path.projectSkills(cwd)
    : Path.skills()

const findOwn = async ({ name, cwd = process.cwd(), scope = 'global' } = {}) => {
    const root = ownRoot({ cwd, scope })
    const descriptor = {
        id: scope === 'project' ? 'own-project' : 'own',
        label: '本应用',
        app: 'Agent',
        path: root,
        scope,
        kind: 'own',
        editable: true,
    }
    const skills = await scan(root, descriptor)
    return { root, skill: skills.find(item => item.name === name) }
}

// --- 应用自己的技能目录永远生效，不允许再作为外部来源启用 ---
const isOwnPath = path => samePath(path, Path.skills())
    || /(^|[\\/])\.agent[\\/]skills[\\/]?$/i.test(normal(path))

export default {
    state,
    saveState,
    setDisabled,
    setSource,
    candidates,
    scan,
    describe,
    list,
    read,
    ownRoot,
    findOwn,
    isOwnPath,
    samePath,
    inside,
    isDirectory,
}
