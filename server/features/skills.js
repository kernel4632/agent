/*
 * 技能：扫描、读取、启用和删除技能，全部规则都在这一份文件里。
 *
 * 技能来源有三类：应用自己的全局目录、会话目录下的 .agent/skills、用户启用的外部目录；
 * 状态保存在数据目录的 skills.json。扫描结果只在这里实现，tools/skill.js 和
 * commands/admin.js 的技能方法和本文件共用同一份规则。
 *
 * 调用示例：
 *   const { skills } = await Skills.list({ cwd })
 *   const skill = await Skills.read({ name: 'review', cwd })
 *   await Skills.save({ name: 'review', description: '审查代码', body: '# Review' })
 */

import { mkdir, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { writeFile } from 'atomically'
import matter from 'gray-matter'
import fail from '../utils/fail.js'
import Path from '../utils/path.js'
import Fs from '../utils/fs.js'
import Text from '../utils/text.js'

const MAX_SKILLS = 200                 // 一个目录最多收这么多技能，防止有人把大仓库指进来
const MAX_BYTES = 256 * 1024           // 一份 SKILL.md 的上限
const PREVIEW_BYTES = 4096             // 只列清单时读前面这一段就够了

// --- 路径比较：Windows 不区分大小写 ---
// 统一用 Path.samePath；本文件以前自己写过一份，两处漂移过一次。
const samePath = Path.samePath
const inside = Fs.inside
// 归一成绝对路径；只做字符串层面的整理，不碰文件系统。
const normal = value => resolve(String(value))

// --- 这个路径是不是一个目录 / 一个普通文件 ---
// 都用 stat（而不是 lstat）：~/.claude/skills 这类目录常常是指向真实技能库的
// symlink/junction，lstat 会把它们当成非目录直接跳过。
const isDirectory = Fs.isDirectory
const isFile = Fs.isFile

// --- 技能目录状态：外部目录和禁用名单 ---
const textList = Text.textList

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

// --- 白名单：允许手动添加的外部技能目录必须落在这几个根之下，防止把整盘递归进来 ---
const whitelistRoots = () => {
    const home = Path.userHome()
    const configHome = process.env.XDG_CONFIG_HOME || join(home, '.config')
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming')
    return [
        home,                                          // 用户主目录下的配置（.claude、.codex 等）
        configHome,                                    // XDG 配置目录（opencode 等）
        appData,                                       // Windows 应用数据目录
        Path.root(),                                   // 本应用数据目录
    ]
}

const isWhitelisted = path => whitelistRoots().some(root => inside(root, normal(path)))

// --- 启用或停用一个外部技能目录；不在白名单内的目录一律不收 ---
const setSource = async ({ path, enabled }) => {
    const current = await state()
    const target = normal(path)
    if (enabled && !isWhitelisted(target)) throw new Error(`skill source must be under a known config directory: ${target}`)
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
        { id: 'opencode', label: 'opencode', app: 'opencode', path: join(configHome, 'opencode', 'skills'), scope: 'global', kind: 'app' },
        { id: 'opencode-singular', label: 'opencode', app: 'opencode', path: join(configHome, 'opencode', 'skill'), scope: 'global', kind: 'app' },
        { id: 'opencode-windows', label: 'opencode', app: 'opencode', path: join(appData, 'opencode', 'skills'), scope: 'global', kind: 'app' },
        { id: 'opencode-windows-singular', label: 'opencode', app: 'opencode', path: join(appData, 'opencode', 'skill'), scope: 'global', kind: 'app' },
        { id: 'agents-shared', label: '通用 Agent 目录', app: 'Agent（共享）', path: join(home, '.agents', 'skills'), scope: 'global', kind: 'app' },
        { id: 'cursor', label: 'Cursor', app: 'Cursor', path: join(home, '.cursor', 'skills'), scope: 'global', kind: 'app' },
        { id: 'cursor-project', label: 'Cursor（当前目录）', app: 'Cursor', path: join(cwd, '.cursor', 'skills'), scope: 'project', kind: 'app' },
    ]
}

// --- 读一份 SKILL.md；缺名字或说明的坏文件直接跳过 ---
const readFile = async (file, root, { preview = false, body = false } = {}) => {
    try {
        const handle = Bun.file(file)
        if (!(await handle.exists()) || handle.size > MAX_BYTES) return null
        // 列表只需要前面的头部；正文只在真正读取这一个技能时才读全文。
        const text = preview ? await handle.slice(0, PREVIEW_BYTES).text() : await handle.text()
        const { data, content } = matter(text)
        const name = typeof data.name === 'string' ? data.name.trim() : ''
        const description = typeof data.description === 'string' ? data.description.trim() : ''
        if (!name || !description) return null
        const path = normal(file)
        return {
            name,
            description,
            body: body && !preview ? content.trim() : '',
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
// 用 readdir + stat 而不是 Bun.Glob：Glob 在 symlink（junction）目录下会静默丢掉大部分条目，
// 而 ~/.claude\skills、~/.agents\skills 这类目录常常是指向真实技能库的链接。readdir + stat
// 都会正确跟随链接，且仍然是固定一层的轻量扫描，不递归下钻。
const scan = async (path, root, { preview = false, body = false } = {}) => {
    if (!(await isDirectory(path))) return []
    let entries = [path]                                   // 目录本身可能就是一个技能
    try {
        entries = [path, ...(await readdir(path)).map(name => join(path, name))]
    } catch {
        // 目录读不了时只保留目录本身那一次尝试。
    }

    const skills = new Map()
    for (const directory of entries) {
        if (skills.size >= MAX_SKILLS) break
        const file = join(directory, 'SKILL.md')
        // stat 先探一下是不是文件，避免对每个候选目录都读一次文件头。
        if (!(await isFile(file))) continue
        const skill = await readFile(file, root, { preview, body })
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
const catalogList = async ({ cwd = process.cwd(), includeDisabled = true } = {}) => {
    const saved = await state()
    const roots = await describe({ cwd, saved })
    const skills = new Map()
    for (const root of roots) {
        if (!root.exists || !root.enabled) continue
        for (const skill of await scan(root.path, root, { preview: true })) skills.set(skill.name, skill)
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

// --- 读正文时才读整份文件，列表不把几百 KB 的正文带出来 ---
const withBody = async skill => {
    const detail = await readFile(skill.path, {
        id: skill.source,
        label: skill.sourceLabel,
        app: skill.app,
        scope: skill.scope,
        kind: skill.kind,
        editable: skill.editable,
    }, { body: true })
    return detail ? { ...skill, body: detail.body } : skill
}

// --- 按名字取一个技能；禁用中的技能也能读到，管理页要能重新打开 ---
// 找不到时返回 null：utils 不懂 HTTP 语义，404 由调用它的 features 层翻译。
const catalogRead = async ({ name, cwd = process.cwd(), includeDisabled = true } = {}) => {
    if (typeof name !== 'string' || !name.trim()) return null
    const { skills } = await list({ cwd, includeDisabled })
    const skill = skills.find(item => item.name === name)
    return skill ? withBody(skill) : null
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
    const skills = await scan(root, descriptor, { preview: true })
    return { root, skill: skills.find(item => item.name === name) }
}

// --- 应用自己的技能目录永远生效，不允许再作为外部来源启用 ---
const isOwnPath = path => samePath(path, Path.skills())
    || /(^|[\\/])\.agent[\\/]skills[\\/]?$/i.test(normal(path))

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

// --- 列出技能；默认含禁用项，工具清单传 includeDisabled=false ---
const list = async ({ cwd = process.cwd(), includeDisabled = true } = {}) => catalogList({ cwd, includeDisabled })

// --- 读一个技能的正文；找不到时返回 null，管理接口再翻译成 404 ---
const read = async ({ name, cwd = process.cwd(), includeDisabled = true } = {}) => {
    if (typeof name !== 'string' || !name.trim()) throw fail(400, 'skill name is required')
    const skill = await catalogRead({ name: name.trim(), cwd, includeDisabled })
    if (!skill) throw fail(404, `Skill not found: ${name}`)
    return skill
}

// --- 新建或改写本应用自己的技能 ---
const save = async ({ name, description, body = '', cwd = process.cwd(), scope = 'global' } = {}) => {
    const skillName = validateName(name)
    const summary = validateDescription(description)
    const content = validateBody(body)
    const targetScope = validateScope(scope)
    if (typeof cwd !== 'string' || !cwd.trim()) throw fail(400, 'cwd must be a directory path')
    if (targetScope === 'project' && !(await isDirectory(cwd))) throw fail(400, `folder does not exist: ${cwd}`)

    const { root, skill } = await findOwn({ name: skillName, cwd, scope: targetScope })
    let directory = skill?.directory
    if (!directory) {
        // 同名文件夹可能属于另一个技能，换一个后缀，不能覆盖别人的 SKILL.md。
        const base = folderFor(skillName)
        directory = join(root, base)
        let index = 2
        while (await isDirectory(directory)) directory = join(root, `${base}-${index++}`)
    }

    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), matter.stringify(`${content}\n`, { name: skillName, description: summary }))

    const saved = await findOwn({ name: skillName, cwd, scope: targetScope })
    if (!saved.skill) throw fail(500, `skill was written but cannot be read back: ${skillName}`)
    return { ...saved.skill, enabled: true }
}

// --- 删除本应用自己的技能；外部目录和项目目录以外的文件一律不动 ---
const remove = async ({ name, cwd = process.cwd(), scope = 'global' } = {}) => {
    const skillName = validateName(name)
    const targetScope = validateScope(scope)
    const { root, skill } = await findOwn({ name: skillName, cwd, scope: targetScope })
    if (!skill) throw fail(404, `Skill not found: ${skillName}`)
    if (!inside(root, skill.directory) || resolve(skill.directory) === resolve(root)) {
        throw fail(400, 'refusing to delete a skill folder outside its own directory')
    }

    await rm(skill.directory, { recursive: true, force: false })
    await setDisabled({ name: skillName, disabled: false })
    return { ok: true, name: skillName }
}

// --- 把技能从模型清单里拿掉或放回来；文件留在磁盘上 ---
const toggle = async ({ name, enabled, cwd = process.cwd() } = {}) => {
    if (typeof name !== 'string' || !name.trim()) throw fail(400, 'skill name is required')
    if (typeof enabled !== 'boolean') throw fail(400, 'enabled must be true or false')
    const { skills } = await list({ cwd })
    if (!skills.some(skill => skill.name === name.trim())) throw fail(404, `Skill not found: ${name}`)
    return setDisabled({ name: name.trim(), disabled: !enabled })
}

// --- 启用或停用一个外部技能目录 ---
const source = async ({ path, enabled } = {}) => {
    if (typeof path !== 'string' || !path.trim()) throw fail(400, 'source path is required')
    if (typeof enabled !== 'boolean') throw fail(400, 'enabled must be true or false')
    const target = resolve(path.trim())
    if (await isOwnPath(target)) throw fail(400, 'the application skill folders are always enabled')
    if (!isWhitelisted(target)) throw fail(400, 'skill sources are limited to known config directories')

    if (enabled) {
        if (!(await isDirectory(target))) throw fail(400, `folder does not exist: ${target}`)
        const root = { id: 'source', label: target, app: '外部目录', path: target, scope: 'global', kind: 'source', editable: false }
        const found = await scan(target, root, { preview: true })
        if (!found.length) throw fail(400, 'no usable skills found in this folder')
    }

    await setSource({ path: target, enabled })
    return { path: target, enabled }
}

export default { list, read, save, remove, toggle, source }

