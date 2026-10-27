/*
 * 一次工具调用会碰到哪些文件。
 *
 * 哪些工具碰文件、从哪个参数取路径，由工具文件自己声明（files 字段），
 * 扫描时登记到这里；忽略规则和文件快照都读这张运行时表。
 * 调用示例：
 *   ToolFiles.register({ name: 'edit', files: input => [input.file_path] })
 *   toolFiles({ toolName: 'edit', input: { file_path: 'a.txt' } }) // ['a.txt']
 */

import { canonical } from './tool-names.js' // 旧名字也要能取到同一个路径。

// 工具扫描时登记；没登记的工具当作不碰文件。
const readers = new Map()

// --- 登记一个工具的文件参数读取方式 ---
export const registerToolFiles = ({ name, files }) => {
    if (!name || typeof files !== 'function') return
    readers.set(canonical(name), files)
}

// --- 取出这次调用要碰的文件路径 ---
export const toolFiles = ({ toolName, input }) => {
    const reader = readers.get(canonical(toolName))
    if (!reader) return []
    return (reader(input) || []).filter(path => typeof path === 'string' && path.trim())
}

// --- 测试和工具目录用：看当前登记了哪些文件工具 ---
export const fileToolNames = () => [...readers.keys()]
