/*
扩展前端打包：.vue 编进同一个文件，vue 换成网页的全局 Vue；
扩展目录旁没有 node_modules 时，裸包名退回到后端依赖里找；改 frontend/ 里任何文件（不只是入口）都会重打。
不起服务，不碰真模型。
*/

import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, utimes, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Bundle } from '../features/Bundle.js'

const root = await mkdtemp(join(tmpdir(), 'agent-bundle-'))
const folder = join(root, 'demo')

async function write(path, text, stamp) {
    await writeFile(join(folder, path), text)
    if (stamp) await utimes(join(folder, path), stamp, stamp)
}

afterAll(() => rm(root, { recursive: true, force: true }))

describe('Bundle', () => {
    test('图标包从后端依赖解析，vue 留给网页', async () => {
        await mkdir(join(folder, 'frontend'), { recursive: true })
        await write('frontend/index.js', "import { PlusSignIcon } from '@hugeicons/core-free-icons'\nimport View from './View.vue'\nexport default app => app.done = [PlusSignIcon, View]\n", new Date(1_000_000))
        await write('frontend/View.vue', '<script setup>\nimport { ref } from \'vue\'\nconst count = ref(1)\n</script>\n<template><b>{{ count }}</b></template>\n', new Date(1_000_000))
        const code = await Bundle.pack('demo', folder)
        expect(code).not.toMatch(/from\s*["']@hugeicons/)
        expect(code).not.toMatch(/from\s*["']vue["']/)
        expect(code).toContain('__agentVue__')
        expect(code).toContain('PlusSignIcon')
    })

    test('只改 .vue 也会重新打包', async () => {
        const before = await Bundle.pack('demo', folder)
        expect(await Bundle.pack('demo', folder)).toBe(before)
        await write('frontend/View.vue', '<template><i>changed-view</i></template>\n', new Date(2_000_000))
        const after = await Bundle.pack('demo', folder)
        expect(after).not.toBe(before)
        expect(after).toContain('changed-view')
    })
})
