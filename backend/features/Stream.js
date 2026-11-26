/*
推送通道：每个页签一条订阅，连上先发快照再接实时事件。
进行中的尾巴从最近一次写进历史之后收到的 core 事件算起；相邻的同类片段合并成一条，
所以刷新时只要把尾巴喂给前端已有的 receive，不必重放全部片段。

快照和订阅必须在同一个同步步骤里完成（先登记再取快照，中间没有 await），这样不会漏帧也不会重帧。
本文件不引用 Agents：快照里的历史和运行状态由调用方传入，尾巴由这里维护。
*/

const subs = new Map()
const tails = new Map()

function slot(id) {
    let tail = tails.get(id)
    if (!tail) tails.set(id, tail = { events: [], retryUntil: undefined })
    return tail
}

// 相邻的 text / reasoning（同一 compact 标记）、同一调用的 tool-input / 同一路 tool-output，合并成一条。
function merge(tail, event) {
    const last = tail.events.at(-1)
    const same = last && last.type === event.type
    if (same && (event.type === 'text' || event.type === 'reasoning') && last.compact === event.compact) {
        last.text += event.text
        return
    }
    if (same && event.type === 'tool-input' && last.toolCallId === event.toolCallId) {
        last.delta += event.delta
        return
    }
    if (same && event.type === 'tool-output' && last.toolCallId === event.toolCallId && last.stream === event.stream) {
        last.data += event.data
        return
    }
    tail.events.push({ ...event })
}

export const Stream = {
    // 登记一个订阅者。返回取消函数。调用方必须紧接着发出快照，中间不能 await。
    subscribe(id, send) {
        const set = subs.get(id) ?? new Set()
        set.add(send)
        subs.set(id, set)
        return () => { set.delete(send); if (!set.size) subs.delete(id) }
    },

    emit(id, name, data) {
        for (const send of subs.get(id) ?? []) send(name, data)
    },

    // 收到一条 core 事件：加进尾巴并广播。message 表示历史已推进，尾巴从零开始。
    add(id, event) {
        const tail = slot(id)
        if (event.type === 'message') {
            tail.events = []
            tail.retryUntil = undefined
        } else {
            merge(tail, event)
            if (event.type === 'request-error' && event.retry) tail.retryUntil = Date.now() + event.retry.delay
            if (event.type === 'request-start') tail.retryUntil = undefined
        }
        Stream.emit(id, 'core', event)
    },

    tail(id) { return slot(id).events },
    retryDeadline(id) { return slot(id).retryUntil },

    // 截断历史或重启后清掉尾巴，避免把已落盘的片段再喂一遍。
    clear(id) { tails.delete(id) },
}
