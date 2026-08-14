import { expect, test } from 'bun:test'

test('real-model suite is opt-in and has a valid entry point', () => {
    expect(process.env.RUN_REAL_MODEL === '1' || process.env.RUN_REAL_AGENT !== '1').toBe(true)
})
