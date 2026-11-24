/*
扩展前端的空实现：生产构建用它替换 dev-extensions.ts（见 vite.config.ts 的 alias），
?ext= 的开发加载器和扩展源码都不会进生产产物。
*/

export async function loadDevExtensions(_dev: string[], _shared: Record<string, unknown>) {
    // 生产环境没有 vite dev server，?ext= 不可用；安静的空实现。
}
