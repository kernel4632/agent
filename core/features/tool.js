/* 
目标被调用形式：
// 积木 1：扫描工具目录，得到一份独立的工具集合
const tools = await Tool.scan("/path/to/tools")
// tools.schema   → 给 LLM 的 AI SDK 标准工具描述，直接放进 LLM.chat 的 tools
// tools.handlers → 给执行器的工具处理表，直接放进 Tool.execute 的 handlers

// 积木 2：执行工具（模型调工具时调用）
const result = await Tool.execute({
    name: "finish",              // 要执行哪个工具
    input: { result: "任务完成" }, // 工具参数，直接传给工具的 execute
    handlers: tools.handlers,    // 工具处理表，用来找到 finish 怎么执行
    signal: abortSignal,         // 触发即杀，工具瞬间死
    onOutput: output => {},      // 工具产生一段输出时调用，调用方决定如何展示或转发
})
*/

import { pathToFileURL } from 'node:url'
import { jsonSchema } from 'ai'

const workerFile = new URL('../utils/tool-worker.js', import.meta.url) // Worker 执行文件路径，启动 Worker 时用。

// 把工具的返回值整理成模型能读懂的格式。
const standardOutput = (handler, result) => {
    const output = result?.output ?? result                                                      // 工具可以返回 { output } 对象，也可以直接返回值。
    if (typeof handler.toModelOutput === 'function') return handler.toModelOutput(output)        // 工具自带格式化函数时优先用它。
    if (output === undefined || output === null || output === '') return { type: 'text', value: '工具执行成功，但没有输出' }
    if (typeof output === 'string') return { type: 'text', value: output }
    return { type: 'json', value: output }
}

// 扫描工具目录，返回一份完全独立的工具集合。
// 不写任何模块级变量，所以多次扫描互不影响，多个 Agent 可以各用各的工具目录。
const scan = async (directory) => {
    const schema = {}   // 工具名 → 给 LLM 的工具描述（不含执行信息）。
    const handlers = {} // 工具名 → 给执行器的处理信息（不给 LLM 看）。
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
            const { execute, toModelOutput, ...modelTool } = tool // 执行相关的字段剥离出来，剩下的才给模型看。

            // schema 只放模型需要的东西：工具叫什么、干什么、要什么参数。
            schema[tool.name] = {
                ...modelTool,
                inputSchema: tool.inputSchema?.['~standard'] ? tool.inputSchema : jsonSchema(tool.inputSchema), // 统一转成 AI SDK 认识的格式。
            }

            // handlers 只放执行需要的东西，模型永远看不到这里。
            // location 记住工具在哪个文件的第几个，因为函数没法传给 Worker（平台限制），
            // 只能让 Worker 拿着文件路径自己重新 import 一次。
            handlers[tool.name] = { execute, toModelOutput, location: { url, index } }
        }
    }

    return { schema, handlers }
}

// 执行一个工具。handlers 必须由调用方明确传入，不存在默认工具表。
const execute = async ({ name, input, handlers, signal, onOutput }) => {
    const handler = handlers?.[name] // 用工具名从处理表里找到这个工具怎么执行。
    if (!handler) throw new Error(`Tool ${name} was not found in handlers`)

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
                output.push(String(data.data))                                   // 缓存流式输出，取消时拼进结果。
                onOutput?.({ tool: name, stream: data.stream, data: data.data })  // 实时通知上层，上层决定如何展示。
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
            resolve({ ...result, output: standardOutput(handler, data.result) })
        })

        worker.addEventListener('error', error => {
            if (finished) return
            finished = true
            signal?.removeEventListener('abort', stop)
            worker.terminate()
            reject(error)
        })

        worker.postMessage({ url: handler.location.url, index: handler.location.index, input }) // 告诉 Worker 去哪个文件、第几个工具、用什么参数。
    })
}

export default { scan, execute }
