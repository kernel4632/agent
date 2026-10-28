/*
 * 工作区边界：工具要碰的文件如果跑到了工作区外，必须由 external_directory 规则明确允许。
 *
 * 这条规则和普通工具规则分开，是因为"读这个文件"和"读这个工作区以外的文件"是两件事：
 * 用户可能允许读随便读，但不希望模型顺手翻到桌面、下载目录或别的项目里。
 * 不配置 external_directory 时保持原来的行为；配置之后默认 ask，写错规则值也按 ask 处理。
 *
 * 只检查能直接看出路径的工具（read_file、write_to_file、edit、apply_patch、
 * list_files、glob、search_files）和 execute_command 的 cwd；命令字符串里的路径不解析。
 * 调用示例：
 *   await Boundary.check({ toolName: 'read_file', input: { path: 'D:/other/a.txt' } })
 *   // { effect: 'allow' | 'ask' | 'deny', paths: [...] }
 */

import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import picomatch from 'picomatch'
import Store from '../agent/state.js'
import { toolFiles } from '../tool-registry/files.js'
import { canonical } from '../tool-registry/names.js' // 旧工具名也能走到同一条检查。

// --- 路径统一用正斜杠，Windows 和 POSIX 的规则写法一致 ---
const slash = value => String(value).replace(/\\/g, '/')

// Windows 比较路径时忽略大小写。
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value

// --- 规则里的 ~ 和 $HOME 换成真实的家目录 ---
const expand = pattern => {
    const home = slash(homedir())
    return slash(pattern).replace(/^~(?=$|\/)/, home).replace(/^\$HOME(?=$|\/)/, home)
}

// --- 把一个路径解析成真实路径；文件还不存在时，解析它最近的已存在父目录 ---
const realPath = async path => {
    try {
        return await realpath(path)
    } catch {
        const parent = dirname(path)
        if (parent === path) return path
        return join(await realPath(parent), basename(path))
    }
}

// --- 这个路径是不是在根目录里面 ---
const isInside = ({ root, path }) => {
    const rel = relative(fold(root), fold(path))
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

// --- 规则值只认三种写法，其余按询问处理 ---
const normalize = value => value === 'allow' ? 'allow' : value === 'deny' ? 'deny' : 'ask'

/**
 * 一次工具调用直接点名的路径。
 * execute_command 只检查它声明的目录，命令字符串里的路径不解析。
 * @param {{ toolName: string, input: object }} call 工具名和参数。
 * @returns {string[]} 可能在工作区外的路径。
 */
const pathsFor = ({ toolName, input }) => {
    const name = canonical(toolName)
    const paths = [...toolFiles({ toolName: name, input })]
    const directory = input?.cwd ?? input?.directory // 新参数 cwd，旧调用 directory。
    if (name === 'execute_command' && typeof directory === 'string') paths.push(directory)
    return paths.filter(path => typeof path === 'string' && path.trim())
}

/**
 * 按 external_directory 规则判断一组路径。
 * 每个路径各自匹配一次，最后一条命中的模式说了算；任意一个被拒绝就整体拒绝。
 * @param {{ paths: string[], rule?: object|string }} input 路径和规则。
 * @returns {'allow'|'ask'|'deny'} 汇总后的结果。
 */
const effectFor = ({ paths, rule }) => {
    const patterns = rule && typeof rule === 'object' && !Array.isArray(rule) ? Object.entries(rule) : []
    let overall = 'allow'
    for (const path of paths) {
        let effect = typeof rule === 'string' ? normalize(rule) : 'ask'
        for (const [pattern, result] of patterns) {
            if (picomatch.isMatch(slash(path), expand(pattern), { bash: true, dot: true })) effect = normalize(result)
        }
        if (effect === 'deny') return 'deny'
        if (effect === 'ask') overall = 'ask'
    }
    return overall
}

/**
 * 检查一次工具调用有没有越出工作区。
 * @param {{ toolName: string, input?: object, workspace?: string }} call
 *   workspace 默认是后端启动时所在的目录；测试可以显式传。
 * @returns {Promise<{ effect: 'allow'|'ask'|'deny', paths: string[] }>}
 *   paths 是实际落在工作区外的绝对路径；没有越界时是空数组，effect 为 allow。
 */
const check = async ({ toolName, input = {}, workspace = process.cwd() } = {}) => {
    // 没配 external_directory 时保持原来的行为，不额外拦工作区外的路径。
    // 配了之后每一条都要按规则判断，默认是 ask。
    const rule = Store.config.permission?.external_directory
    if (rule == null) return { effect: 'allow', paths: [] }

    const root = await realPath(workspace)
    const outside = []
    for (const path of pathsFor({ toolName, input })) {
        const absolute = await realPath(isAbsolute(path) ? path : resolve(process.cwd(), path))
        if (!isInside({ root, path: absolute })) outside.push(absolute)
    }
    if (!outside.length) return { effect: 'allow', paths: [] }
    return { effect: effectFor({ paths: outside, rule }), paths: outside }
}

export default { check, effectFor, pathsFor }
