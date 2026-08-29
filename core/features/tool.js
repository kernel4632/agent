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
 tool: tools,             // 工具表快照，用来找到 finish 这个工具
 signal: abortSignal,     // 触发即杀，工具瞬间死
 onOutput: output => {},  // 工具产生一段输出时调用，调用方决定如何展示或转发
}) 
*/

import { pathToFileURL } from 'node:url'
import { jsonSchema } from 'ai'

const workerFile = new URL('../utils/tool-worker.js', import.meta.url) // Worker 执行文件路径，启动 Worker 时用。

// 工具名 → { url, index }，记住每个工具在哪个文件的第几个位置。
// 执行时只传文件路径给 Worker，Worker 自己重新 import 拿到 execute 函数。
// （函数没法直接传给 Worker，这是平台限制，不是设计选择）
const locations = {}

const standardOutput = (tool, result) => {
    const output = result?.output ?? result                                                   // 工具可以返回 { output } 对象，也可以直接返回值。
    if (typeof tool.toModelOutput === 'function') return tool.toModelOutput(output)          // 工具自定义输出格式时优先用它。
    if (output === undefined || output === null || output === '') return { type: 'text', value: '工具执行成功，但没有输出' }
    if (typeof output === 'string') return { type: 'text', value: output }
    return { type: 'json', value: output }
}

// 当前工具表：{ 工具名 → 工具信息 }。scan() 每次成功后整体替换。
let tools = {}

const scan = async (directory) => {
    const loaded = {} // 先装入临时对象，扫描失败不影响旧工具表。
    const scanId = Date.now()
    const files = []

    // 先收集完整文件列表再排序，保证每次扫描同一目录的加载顺序都一样。
    for await (const file of new Bun.Glob('**/*.js').scan({ cwd: directory, absolute: true, onlyFiles: true })) files.push(file)
    files.sort()

    for (const file of files) {
        const url = `${pathToFileURL(file).href}?scan=${scanId}`                             // 带时间戳绕过 import 缓存，改了文件就能立刻生效。
        const module = await import(url)
        const exported = Array.isArray(module.default) ? module.default : [module.default]  // 一个文件可以导出一个工具，也可以导出一组工具。

        for (const [index, tool] of exported.entries()) {
            const { execute, ...modelTool } = tool                                           // 把 execute 剥离，模型只需要描述和 Schema，不需要执行函数。
            Object.assign(modelTool, {
                inputSchema: tool.inputSchema?.['~standard'] ? tool.inputSchema : jsonSchema(tool.inputSchema), // 统一转成 AI SDK 认识的格式。
            })
            loaded[tool.name] = modelTool         // 工具信息存工具表，用工具名作 key。
            locations[tool.name] = { url, index } // 执行位置也用工具名存，执行时直接查。
        }
    }

    tools = loaded // 扫描成功后整体替换，中途失败时旧工具表继续有效。
    return tools
}

const execute = async ({ name, input, tool = tools, signal, onOutput }) => {
    const selected = (Array.isArray(tool) ? tool.find(item => item.name === name) : tool[name]) ?? tools[name] // 工具表可以是对象也可以是数组，找不到就回退到当前工具表。
    const location = locations[name] // 用工具名找到执行位置（文件路径 + 数组下标）。
    if (!location) throw new Error(`Tool ${name} was not loaded by Tool.scan()`)

    return new Promise((resolve, reject) => {
        const worker = new Worker(workerFile) // 每次执行都开一个新 Worker，可以被主线程强制终止。
        let finished = false
        const output = [] // 收集工具产生的所有流式输出，取消时一起返回给模型。

        // 取消信号触发时立即杀掉 Worker，已输出的内容一并返回。
        const stop = () => {
            if (finished) return
            finished = true
            worker.terminate()
            resolve({ output: { type: 'error-text', value: `${output.join('')}\n工具执行已中断` }, interrupted: true })
        }

        signal?.addEventListener('abort', stop, { once: true })
        if (signal?.aborted) return stop() // 进来之前就已经取消了，直接停。

        worker.addEventListener('message', ({ data }) => {
            if (finished) return

            if (data.type === 'output') {
                output.push(String(data.data))                              // 缓存流式输出，取消时拼进结果。
                onOutput?.({ tool: name, stream: data.stream, data: data.data }) // 实时通知上层，上层决定如何展示。
                return
            }

            // 收到 done 或 error，工具执行结束，清理并返回结果。
            finished = true
            signal?.removeEventListener('abort', stop) // 不再需要监听取消了。
            worker.terminate()                         // 关闭 Worker，释放资源。

            if (data.type === 'error') {
                resolve({ output: { type: 'error-text', value: `工具执行失败：${data.message}` }, error: data.message })
                return
            }
            const result = data.result && typeof data.result === 'object' ? data.result : {}
            resolve({ ...result, output: standardOutput(selected, data.result) })
        })

        worker.addEventListener('error', error => {
            if (finished) return
            finished = true
            signal?.removeEventListener('abort', stop)
            worker.terminate()
            reject(error)
        })

        worker.postMessage({ url: location.url, index: location.index, input }) // 告诉 Worker 去哪个文件、第几个工具、用什么参数。
    })
}

export default { scan, execute }
