/* 
目标被调用形式（绝对不可修改）：
// 积木 1：扫描工具（Agent 循环开始时调用一次）
const tools = await Tool.scan(directory = "/path/to/tools")

// 积木 2：执行工具（模型调工具时调用）
const result = await Tool.execute({
    name: "finish",              // 要执行哪个工具
    input: {                     // 工具参数，直接传给工具的 execute
        result: "任务完成",
 },
 tool: func,                // 工具快照，用来找到 finish 这个工具
 signal: abortSignal,     // 触发即杀，工具瞬间死
 onOutput: output => {},  // 工具产生一段输出时调用，调用方决定如何展示或转发
}) 
*/

import { pathToFileURL } from 'node:url'

const workerFile = new URL('../utils/tool-worker.js', import.meta.url)
const locations = new WeakMap()

// 这是当前正在使用的工具列表。
// scan() 每次运行都会把它整体替换，所以工具目录可以随时变化。
let tools = {}

const scan = async (directory) => {
    const loaded = {}
    const scanId = Date.now()
    const files = []

    // 先拿到完整文件列表，再排序，保证相同目录每次都有稳定的加载顺序。
    for await (const file of new Bun.Glob('**/*.js').scan({
        cwd: directory,
        absolute: true,
        onlyFiles: true,
    })) {
        files.push(file)
    }
    files.sort()

    for (const file of files) {
        // 查询参数用来绕过 import 缓存。
        // 这样文件内容改过后，再次 scan() 就能立刻拿到新代码。
        const url = `${pathToFileURL(file).href}?scan=${scanId}`
        const module = await import(url)
        const exported = Array.isArray(module.default) ? module.default : [module.default]

        // 一个文件可以导出一个工具，也可以导出一组工具。
        // 不额外检查工具结构，目录里有什么就加载什么。
        for (const [index, tool] of exported.entries()) {
            loaded[tool.name] = tool
            locations.set(tool, { url, index })
        }
    }

    // 扫描成功后再整体替换，扫描中途失败不会留下半套工具列表。
    tools = loaded
    return tools
}

const execute = async ({ name, input, tool = tools, signal, onOutput }) => {
    // tool 是 Agent 循环开始时拿到的工具快照。
    // 调用方传快照时，后续 scan() 不会影响这次循环。
    const selected = Array.isArray(tool)
        ? tool.find(item => item.name === name)
        : tool[name]

    const location = locations.get(selected)
    if (!location) throw new Error(`Tool ${name} was not loaded by Tool.scan()`)

    return new Promise((resolve, reject) => {
        // 每次执行都使用新的 Worker。Worker 可以被主线程强制销毁，
        // 所以工具函数不需要知道 AbortSignal，也不需要配合清理。
        const worker = new Worker(workerFile)
        let finished = false
        let outputQueue = Promise.resolve()

        const stop = () => {
            if (finished) return
            finished = true
            worker.terminate()
            reject(new DOMException('Tool execution aborted', 'AbortError'))
        }

        const cleanup = () => {
            signal?.removeEventListener('abort', stop)
            worker.terminate()
        }

        signal?.addEventListener('abort', stop, { once: true })
        if (signal?.aborted) return stop()

        worker.addEventListener('message', async ({ data }) => {
            if (finished) return

            if (data.type === 'output') {
                // 执行器只报告输出，不知道 SSE、终端或前端的存在。
                // 调用方可以在这里自行显示、记录，或转发给 SSE。
                if (onOutput) outputQueue = outputQueue.then(() => onOutput({
                    tool: name,
                    stream: data.stream,
                    data: data.data,
                }))
                return
            }

            finished = true
            await outputQueue
            cleanup()
            if (data.type === 'error') {
                reject(Object.assign(new Error(data.message), { stack: data.stack }))
                return
            }
            resolve(data.result)
        })

        worker.addEventListener('error', error => {
            if (finished) return
            finished = true
            cleanup()
            reject(error)
        })

        worker.postMessage({
            url: location.url,
            index: location.index,
            input,
        })
    })
}

export default { scan, execute }
