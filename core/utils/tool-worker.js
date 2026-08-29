/*
工具 Worker 的使用说明

这个文件不是普通工具函数，不能这样直接调用：
const result = await ToolWorker.run() // 错误：本文件没有导出 run 函数

正确用法：由主线程创建 Worker，再发送一条执行消息。
const worker = new Worker(new URL('./tool-worker.js', import.meta.url))
worker.postMessage({
    url: 'file:///绝对路径/tools/read-file.js', // 工具文件地址
    index: 0,                                 // 工具在默认导出数组中的位置；单个工具通常是 0
    input: { path: 'README.md' },             // 传给工具 execute(input) 的参数
})

Worker 会按照下面的消息协议工作：

1. 主线程 → Worker：发送执行任务
   { url, index, input }

2. Worker → 主线程：发送实时输出
   { type: 'output', stream: 'stdout', data: '一段输出' }
   { type: 'output', stream: 'stderr', data: '一段错误输出' }
   { type: 'output', stream: 'console', data: '工具的 console.log 内容' }
   { type: 'output', stream: 'result', data: '异步生成器产生的一段结果' }

3. Worker → 主线程：工具成功结束
   { type: 'done', result: '工具最终返回值' }

4. Worker → 主线程：工具执行失败
   { type: 'error', message: '错误信息', stack: '错误堆栈' }

主线程可以监听这些消息：
worker.addEventListener('message', ({ data }) => {
    if (data.type === 'output') console.log(data.stream, data.data) // 实时处理输出
    if (data.type === 'done') console.log(data.result)              // 处理最终结果
    if (data.type === 'error') console.error(data.message)          // 处理执行错误
})

取消正在执行的工具：
worker.terminate() // 立即终止 Worker；已经发出的 output 无法撤回

工具文件需要默认导出工具对象：
export default {
    name: 'read_file',
    description: '读取文件',
    inputSchema: {},
    async execute(input) {
        return await Bun.file(input.path).text()
    },
}

也可以默认导出多个工具：
export default [firstTool, secondTool]

这个 Worker 会自动转发工具中的 console.log、console.info、console.warn、console.error，
也会自动转发 Bun.spawn() 创建的子进程 stdout 和 stderr。
因此工具作者不需要额外编写 onOutput 回调。
*/

const textDecoder = new TextDecoder()
const pumps = new Set()

const report = (stream, data) => postMessage({
    type: 'output',
    stream,
    data,
})

const readStream = async (stream, name) => {
    if (!stream) return
    const pump = (async () => {
        for await (const chunk of stream) {
            report(name, typeof chunk === 'string' ? chunk : textDecoder.decode(chunk))
        }
    })()
    pumps.add(pump)
    try {
        await pump
    } finally {
        pumps.delete(pump)
    }
}

const originalSpawn = Bun.spawn
Bun.spawn = (command, options = {}) => {
    // 工具不需要专门写“流式输出”代码。
    // 执行器自动把子进程的 stdout 和 stderr 接到 SSE 通道。
    const process = originalSpawn(command, {
        ...options,
        stdout: options.stdout ?? 'pipe',
        stderr: options.stderr ?? 'pipe',
    })
    const [stdoutForSse, stdoutForTool] = process.stdout?.tee?.() ?? [null, process.stdout]
    const [stderrForSse, stderrForTool] = process.stderr?.tee?.() ?? [null, process.stderr]
    readStream(stdoutForSse, 'stdout')
    readStream(stderrForSse, 'stderr')

    // 同一份输出分成两路：执行器实时发送一份，工具自己仍可读取另一份。
    return new Proxy(process, {
        get(target, property) {
            if (property === 'stdout') return stdoutForTool
            if (property === 'stderr') return stderrForTool
            const value = Reflect.get(target, property, target)
            return typeof value === 'function' ? value.bind(target) : value
        },
    })
}

const originalConsole = { ...console }
for (const name of ['log', 'info', 'warn', 'error']) {
    console[name] = (...args) => {
        report('console', args.map(String).join(' '))
        originalConsole[name](...args)
    }
}

const streamResult = async result => {
    if (!result || typeof result[Symbol.asyncIterator] !== 'function') return result

    const chunks = []
    for await (const chunk of result) {
        chunks.push(chunk)
        report('result', chunk)
    }
    return chunks
}

self.onmessage = async ({ data }) => {
    try {
        const module = await import(data.url)
        const exported = Array.isArray(module.default) ? module.default : [module.default]
        const result = await exported[data.index].execute(data.input)
        const finalResult = await streamResult(result)

        // 等 stdout/stderr 最后一点数据发完，再告诉主线程任务完成。
        await Promise.all([...pumps])
        postMessage({ type: 'done', result: finalResult })
    } catch (error) {
        postMessage({
            type: 'error',
            message: error?.message || String(error),
            stack: error?.stack,
        })
    }
}
