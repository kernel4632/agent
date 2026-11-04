import { expect, test } from 'bun:test'
import { app } from '../server.js'

test('显式 family 直接返回，不需要下载模型目录', async () => {
    const response = await app.handle(new Request('http://localhost/model/family?family=deepseek'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
        family: 'deepseek',
        candidates: ['deepseek'],
        ambiguous: false,
        source: 'manual',
    })
})
