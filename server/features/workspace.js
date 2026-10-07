/*
 * 工作区：agent 和界面共同要知道的"我在哪儿、这儿有什么"。
 *
 * 没有工作区时用后端进程的当前目录，所以后端从哪个目录启动，工作区就是哪个目录。
 * 调用示例：
 *   const { path, files, git } = await Workspace.read()
 *   await Workspace.status({ path: 'D:/app' })   // 只看某个目录的 git 状态
 */


// 文件树最多列这么多项；工作区里动辄几万个文件，界面和模型都只需要知道结构。
const FILE_LIMIT = 200

// 这些目录里的文件不是用户写的代码，列出来只会把有用的信息挤掉。
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '__pycache__', '.venv', 'venv', '.cache', 'coverage'])

// --- 一次 git 命令 ---
const git = async (args, cwd) => {
    const process = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, , exitCode] = await Promise.all([process.stdout.text(), process.stderr.text(), process.exited])
    return exitCode === 0 ? stdout.trim() : '' // 不是仓库或没装 git 时都当作"没有 git 信息"。
}

// --- 读 git 状态 ---
const status = async ({ path }) => {
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], path)
    if (!branch) return null // 不是 git 仓库，界面就不用显示分支信息。

    // porcelain 格式每行前两个字符是状态标记，后面是文件路径。
    const lines = (await git(['status', '--porcelain'], path)).split('\n').filter(Boolean)
    const counts = { modified: 0, added: 0, deleted: 0, untracked: 0 }
    for (const line of lines) {
        const code = line.slice(0, 2)
        if (code === '??') counts.untracked += 1
        else if (code.includes('D')) counts.deleted += 1
        else if (code.includes('A')) counts.added += 1
        else counts.modified += 1
    }
    return { branch, changed: lines.length, ...counts }
}

// --- 列出工作区文件 ---
const files = async path => {
    const found = []
    // 只扫三层，够让模型知道项目结构，又不会把整棵树塞进上下文。
    for await (const entry of new Bun.Glob('**/*').scan({ cwd: path, onlyFiles: true, dot: false })) {
        // Windows 上扫描结果用反斜杠分隔；接口对外统一用正斜杠，前端不用分平台处理。
        const normalized = entry.replace(/\\/g, '/')
        const segments = normalized.split('/')
        if (segments.some(segment => SKIP_DIRS.has(segment))) continue
        if (segments.length > 3) continue
        found.push(normalized)
        if (found.length >= FILE_LIMIT) break
    }
    return found
}

// --- 读工作区 ---
const read = async () => {
    const path = process.cwd()
    return {
        path,
        files: await files(path),
        git: await status({ path }), // 不是 git 仓库时是 null。
    }
}

export default { read, status }
