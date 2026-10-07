/*
 * 不用去翻的文件夹名单。
 *
 * 有两份名单，因为两件事要的东西不一样：
 *   - 搜代码（grep / glob）：只跳依赖和缓存。用户可能确实想搜 dist/ 里的产物。
 *   - 列目录摘要（工作区）：连构建产物一起跳，模型要的是用户自己写的代码。
 * 名单只写在这里一处，加一个新目录不用改好几个文件。
 * 调用示例：
 *   Skip.search('node_modules/react/index.js')   // true，搜代码时跳过
 *   Skip.listing('dist/bundle.js')               // true，列目录时跳过
 *   Skip.dependencies                            // 数组，给 ripgrep 拼 --glob 用
 */

// 依赖、版本库内部数据、缓存：这里面的东西几乎不可能是用户要找的代码。
const dependencies = [
    'node_modules',   // 第三方依赖
    '.git',           // 版本库内部数据
    'vendor',         // Go / PHP 的依赖目录
    '.venv',          // Python 虚拟环境
    'venv',
    '__pycache__',    // Python 字节码缓存
    '.cache',
    '.turbo',
    '.parcel-cache',
    '.gradle',
    '.idea',          // 编辑器自己的索引
    '.vscode',
]

// 构建产物：列目录摘要时不值得占位置，但用户主动搜的时候要找得到。
const outputs = [
    'dist',
    'build',
    'out',
    'target',
    '.next',
    '.nuxt',
    '.output',
    '.svelte-kit',
    'coverage',
]

// 列目录摘要时，上面两份一起跳。
const noise = [...dependencies, ...outputs]

// --- 这个路径是不是落在名单里 ---
const inList = (path, list) => {
    // Windows 上路径是反斜杠，先统一成正斜杠再分段比对。
    const segments = String(path).replace(/\\/g, '/').split('/')
    return segments.some(segment => list.includes(segment))
}

export default {
    dependencies,                                              // 搜代码时跳过的目录名
    search: path => inList(path, dependencies),                // 搜代码时该不该跳过这个路径
    listing: path => inList(path, noise),                      // 列目录摘要时该不该跳过
}
