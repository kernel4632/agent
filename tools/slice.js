/*
源码切片工具：括号配对与成员切分，给 graph.js（导出清单）和 flow.js（函数级流程图）共用。
配对时跳过字符串与注释，避免 CSS 模板串、正则字面量里的括号干扰深度。
*/

// JS 关键字不是方法名；全大写（如 BASE）是常量不是函数。
export const KEYWORDS = new Set(['if', 'for', 'while', 'return', 'switch', 'catch', 'try', 'else', 'do', 'get', 'set', 'async', 'await', 'new', 'typeof', 'in', 'of', 'const', 'let', 'var', 'function', 'delete', 'void', 'case', 'break', 'continue', 'throw', 'with', 'finally'])
export const CONSTANT = /^[A-Z][A-Z0-9_]*$/

// 字符串跳过（处理转义）：返回收尾引号的下标。
function skipString(text, start) {
    const quote = text[start]
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === '\\') i++
        else if (text[i] === quote) return i
    }
    return text.length
}

// 花括号配对：从 open 下标（须是 {）找到配对的 } 下标；字符串与注释里的不数。找不到返回 -1。
export function matchBrace(text, open) {
    let depth = 0
    for (let i = open; i < text.length; i++) {
        const ch = text[i]
        if (ch === '"' || ch === "'" || ch === '`') { i = skipString(text, i); continue }
        if (ch === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i); continue }
        if (ch === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) === -1 ? text.length : text.indexOf('*/', i) + 1; continue }
        if (ch === '{') depth++
        else if (ch === '}') { depth--; if (!depth) return i }
    }
    return -1
}

// 圆括号配对（matchBrace 的括号版）。找不到时返回文本末尾，便于调用方兜底。
export function matchParen(text, open) {
    let depth = 0
    for (let i = open; i < text.length; i++) {
        const ch = text[i]
        if (ch === '"' || ch === "'" || ch === '`') { i = skipString(text, i); continue }
        if (ch === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i); continue }
        if (ch === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) === -1 ? text.length : text.indexOf('*/', i) + 1; continue }
        if (ch === '(') depth++
        else if (ch === ')') { depth--; if (!depth) return i }
    }
    return text.length
}

// 从 code 里「名为 name 的 const/let 赋值」抠出对象字面量的成员区（精确括号配对）。
// 只认「右值直接是 { 开头」的对象字面量；reactive(...)、模板串、函数声明都不适用（它们没有成员区）。
// 返回 null 时调用方按「单个导出名」处理。
export function sliceObject(code, name) {
    const head = new RegExp(`(?:const|let)\\s+${name}\\s*=`).exec(code)
    if (!head) return null
    const rest = code.slice(head.index + head[0].length)
    const opener = /\S/.exec(rest)
    if (!opener || opener[0] !== '{') return null
    const end = matchBrace(rest, opener.index)
    return end === -1 ? null : rest.slice(opener.index + 1, end)
}

// 成员区按括号深度 0 切成段，返回每段 { start, end }（相对 body 的下标）。路由表解析也用它。
export function splitTop(body) {
    const parts = []
    let depth = 0, start = 0
    for (let i = 0; i < body.length; i++) {
        const ch = body[i]
        if (ch === '"' || ch === "'" || ch === '`') { i = skipString(body, i); continue }
        if (ch === '/' && body[i + 1] === '/') { i = body.indexOf('\n', i) === -1 ? body.length : body.indexOf('\n', i); continue }
        if (ch === '/' && body[i + 1] === '*') { i = body.indexOf('*/', i) === -1 ? body.length : body.indexOf('*/', i) + 1; continue }
        if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') depth--
        else if (ch === ',' && !depth) { parts.push({ start, end: i }); start = i + 1 }
    }
    parts.push({ start, end: body.length })
    return parts.filter(part => body.slice(part.start, part.end).trim())
}

// 对象成员区 → 顶层成员（括号深度 0 切分）。每个成员返回 { name, body }：
// 方法（name(...) {...}）带函数体；属性（如 errors,）没有体。嵌套对象/闭包不算顶层成员。
export function topMembers(body) {
    const members = []
    let rest = body
    let depth = 0
    for (let i = 0; i < rest.length; i++) {
        const ch = rest[i]
        if (ch === '"' || ch === "'" || ch === '`') { i = skipString(rest, i); continue }
        if (ch === '/' && rest[i + 1] === '/') { i = rest.indexOf('\n', i) === -1 ? rest.length : rest.indexOf('\n', i); continue }
        if (ch === '/' && rest[i + 1] === '*') { i = rest.indexOf('*/', i) === -1 ? rest.length : rest.indexOf('*/', i) + 1; continue }
        if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') depth--
        else if (ch === ',' && !depth) {
            members.push(rest.slice(0, i))
            rest = rest.slice(i + 1); i = -1
        }
    }
    if (rest.trim()) members.push(rest)
    const parsed = []
    for (const part of members) {
        const hit = /(?:^|\n)\s*(?:async\s+)?(\w+)\s*\(/.exec(part)
        if (hit && !KEYWORDS.has(hit[1]) && !CONSTANT.test(hit[1])) {
            const open = part.indexOf('(', hit.index)
            const close = matchParen(part, open)
            const brace = part.indexOf('{', close)
            const end = brace === -1 ? -1 : matchBrace(part, brace)
            parsed.push({ name: hit[1], body: end === -1 ? '' : part.slice(brace + 1, end) })
        } else {
            const key = /^\s*(\w+)\s*[:,}]/.exec(part)
            if (key && !KEYWORDS.has(key[1]) && !CONSTANT.test(key[1])) parsed.push({ name: key[1], body: '' })
            else parsed.push({ name: '', body: part })
        }
    }
    return parsed.filter(item => item.name)
}

// 字符串、模板、正则与注释整体换成空格（保留换行、长度不变）：调用扫描不会踩到字面量里的括号和标识符。
// 正则字面量按「前一个非空字符是 (,=:[!&|?{; 时才算」的启发式判定，够用且不误伤除号。
export function maskLiterals(code) {
    const out = [...code]
    const prev = at => { for (let j = at - 1; j >= 0; j--) if (out[j] !== ' ' && out[j] !== '\n') return out[j]; return '' }
    let i = 0
    while (i < code.length) {
        const ch = code[i]
        if (ch === '"' || ch === "'" || ch === '`') {
            out[i] = ' '
            for (i++; i < code.length; i++) {
                if (code[i] === '\\') { out[i] = ' '; out[i + 1] = ' '; i++; continue }
                const c = code[i]
                if (c === '\n' && ch !== '`') break
                out[i] = c === '\n' ? '\n' : ' '
                if (c === ch) { i++; break }        // 停在闭引号之后，否则外层会把闭引号再当开引号
            }
            continue
        }
        if (ch === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') out[i++] = ' '; continue }
        if (ch === '/' && code[i + 1] === '*') {
            while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) { if (code[i] !== '\n') out[i] = ' '; i++ }
            if (i < code.length) { out[i] = ' '; out[i + 1] = ' '; i++ }
            i++
            continue
        }
        if (ch === '/' && '(,=:[!&|?{;'.includes(prev(i))) {
            out[i] = ' '
            let inClass = false
            for (i++; i < code.length; i++) {
                const c = code[i]
                if (c === '\\') { out[i] = ' '; out[i + 1] = ' '; i++; continue }
                if (c === '\n') break
                if (c === '[') inClass = true
                if (c === ']') inClass = false
                out[i] = ' '
                if (c === '/' && !inClass) break
            }
            continue
        }
        i++
    }
    return out.join('')
}
