/*
 * 测试进程的默认数据目录：所有 bun test 都从系统临时目录开始，绝不碰真实 ~/.agent。
 *
 * 各测试自己的 withHome 仍可切换更细的临时目录；它们恢复时回到这里，
 * 不会把 AGENT_HOME 删掉，避免并发测试在空档里写到用户配置。
 */
import { mkdtemp } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const serverDir = join(import.meta.dir, '..')
Bun.plugin({
    name: 'agent-resolver-preload',
    setup(build) {
        build.onResolve({ filter: /^@agent\// }, args => ({ path: join(serverDir, args.path.slice('@agent/'.length)) }))
    },
})

const root = await mkdtemp(join(tmpdir(), 'agent-test-home-'))
process.env.AGENT_HOME = root

process.on('exit', () => {
    try {
        rmSync(root, { recursive: true, force: true })
    } catch {
        // 退出阶段只做尽力清理；测试目录由系统临时目录兜底。
    }
})
