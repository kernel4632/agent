/*
 * 命令串解析：把一条命令行拆成 argv，并判断它是否必须交给 shell 执行。
 *
 * 为什么需要这个：execute_command 的契约是"执行一条 CLI 命令"，调用方的心理模型是
 * shell 语义——`gh issue close 34 -r "not planned"` 里那个带空格的参数应该是一个整体。
 * 但原来的实现把整条命令当作一个 argv 元素塞给 `cmd /c`，引号既没被解析、又被 cmd
 * 当作字面字符，结果是参数在空格处被劈开，而且报错来自被调用的程序而不是命令层。
 *
 * 这里的策略不是"把命令重新拼一遍交给 shell"（那样还要跟各平台五花八门的转义规则搏斗），
 * 而是：能直接起进程就直接起，把参数原样交给系统；只有真正需要 shell 的才交出去。
 * 判断依据是命令里有没有管道、重定向、变量、通配这些 shell 专属语法——
 * 这些出现在引号里的不算，`git commit -m "a | b"` 仍然走直接执行。
 *
 * 宁可多退回 shell，也不要在解析上冒险：解析失败、命令是 shell 内建、或者首词根本不是
 * 可执行文件，一律退回原来的 shell 路径，行为与改动前一致。
 *
 * 调用示例：
 *   parse('gh issue close 34 -r "not planned"')
 *   // { ok: true, argv: ['gh','issue','close','34','-r','not planned'], needsShell: false }
 *   parse('bun test 2>&1')      // { ok: true, needsShell: true, reason: '>' }
 *   parse('cd a && bun test')   // { ok: true, needsShell: true, reason: '&' }
 */

import { existsSync } from 'node:fs'

// 必须由 shell 处理的字符：管道、重定向、串接、子 shell、变量、命令替换、通配、注释、换行。
// 只有出现在引号外才算——引号里的它们是普通字符。
const SHELL_CHARS = new Set(['|', '&', ';', '<', '>', '(', ')', '$', '`', '*', '?', '~', '#', '\n', '\r'])
// Windows 额外两个：%VAR% 展开、!VAR! 延迟展开，还有 ^ 转义，都归 cmd 管。
const WINDOWS_SHELL_CHARS = new Set(['%', '!', '^'])

// 看起来像路径的首词（绝对路径、./ 开头、盘符开头）：这类不经 PATH 查找。
const LOOKS_LIKE_PATH = /^[/\\]|^\.[/\\]|^[A-Za-z]:[/\\]/

/**
 * 把一条命令行拆成 argv，同时判断是否需要 shell。
 * @param {string} command 原始命令行
 * @param {{ windows?: boolean }} options 平台假设，默认按当前平台
 * @returns {{ ok: boolean, argv: string[], needsShell: boolean, reason: string }}
 *   ok=false 表示引号没闭合之类，调用方应退回 shell；reason 是判定需要 shell 的原因字符。
 */
const parse = (command, { windows = process.platform === 'win32' } = {}) => {
    const text = String(command ?? '')
    const argv = []
    let token = ''
    let pending = false        // 这个 token 已经有了内容（含空引号 ""），收尾时要 push
    let quote = ''             // '' | '"' | "'"
    let needsShell = false
    let reason = ''

    const markShell = why => {
        if (needsShell) return
        needsShell = true
        reason = why
    }

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index]

        // 单引号内全部字面量，反斜杠也不例外
        if (quote === "'") {
            if (char === "'") quote = ''
            else token += char
            continue
        }

        // 双引号内：POSIX 里反斜杠还保留少量转义能力；Windows 里反斜杠是路径分隔符，不能当转义
        if (quote === '"') {
            if (char === '"') { quote = ''; continue }
            if (char === '\\' && !windows) {
                const next = text[index + 1]
                if (next === '"' || next === '\\' || next === '$' || next === '`') {
                    token += next
                    index += 1
                    continue
                }
            }
            token += char
            continue
        }

        // 引号外
        if (char === '"' || char === "'") {
            quote = char
            pending = true                    // "" 也要算一个空参数
            continue
        }
        if (char === '\\' && !windows) {
            // POSIX：反斜杠转义下一个字符；行尾的反斜杠原样保留
            const next = text[index + 1]
            if (next !== undefined) {
                token += next
                pending = true
                index += 1
                continue
            }
            token += char
            pending = true
            continue
        }
        if (/\s/.test(char)) {
            if (pending) {
                argv.push(token)
                token = ''
                pending = false
            }
            continue
        }
        if (SHELL_CHARS.has(char) || (windows && WINDOWS_SHELL_CHARS.has(char))) markShell(char)
        token += char
        pending = true
    }

    // 引号没闭合：不猜，交给 shell 去报它自己的错，行为和改动前一致
    if (quote) return { ok: false, argv: [], needsShell: true, reason: 'unterminated quote' }
    if (pending) argv.push(token)
    return { ok: true, argv, needsShell, reason }
}

/**
 * 首词是不是一个能直接起的可执行文件。
 * shell 内建命令（echo、cd、dir、type……）查不到，返回 false，调用方就会退回 shell。
 * @param {string} name 命令行的第一个词
 * @param {{ cwd?: string }} options 路径形式的命令按这个目录解析
 */
const executable = (name, { cwd } = {}) => {
    if (!name) return false
    if (LOOKS_LIKE_PATH.test(name)) {
        // 路径形式：Bun.which 对相对/绝对路径不可靠，直接看文件在不在
        const target = name
        return existsSync(cwd ? `${cwd}/${target}` : target) || existsSync(target)
    }
    return Boolean(Bun.which(name))
}

export { parse, executable, SHELL_CHARS, WINDOWS_SHELL_CHARS }
export default { parse, executable }
