// 工具真正运行的地方。主线程可以随时 terminate 这个 Worker。

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
