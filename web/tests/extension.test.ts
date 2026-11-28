import { afterEach, describe, expect, test } from 'bun:test'
import { Components, Extension, Loaded, Panels, PlusMenu, Settings, ToolViews } from '../src/Extension'

const cleanup: string[] = []

afterEach(() => {
  for (const name of cleanup.splice(0).reverse()) {
    if (Loaded.some(item => item.name === name)) Extension.unload(name)
  }
  for (const key of Object.keys(Components)) delete Components[key]
})

describe('Extension', () => {
  test('patch 支持多层叠加与单独撤销，目标不存在时抛错', () => {
    const target = { greet: (name: string) => `hi ${name}` }
    expect(() => Extension.patch(target, 'missing', orig => orig)).toThrow('patch 目标不存在：missing')

    const undoA = Extension.patch(target, 'greet', orig => (name: string) => `[A:${orig(name)}]`)
    const undoB = Extension.patch(target, 'greet', orig => (name: string) => `<B:${orig(name)}>`)
    expect(target.greet('world')).toBe('<B:[A:hi world]>')

    undoA()
    expect(target.greet('world')).toBe('<B:hi world>')

    undoB()
    expect(target.greet('world')).toBe('hi world')
  })

  test('app.patch 运行时抛错会记录到 Loaded[].error 并回退调用下层方法', async () => {
    const target = { calc: (n: number) => n * 2 }
    cleanup.push('buggy')
    await Extension.run('buggy', {}, async () => ({
      default: app => {
        app.patch(target, 'calc', () => () => {
          throw new Error('boom')
        })
      },
    }))

    expect(target.calc(5)).toBe(10)
    const record = Loaded.find(item => item.name === 'buggy')
    expect(record?.patched).toEqual(['calc'])
    expect(record?.error).toContain('boom')
  })

  test('run 与 unload 正确管理 patch、dispatch、toolViews、panels、settings、plus 与 components.wrap', async () => {
    const BaseComp = { name: 'BaseComp' } as any
    const WrappedComp = { name: 'WrappedComp' } as any
    const ShellView = { name: 'ShellView' } as any
    const PanelComp = { name: 'PanelComp' } as any
    Extension.register({ ToolCall: BaseComp })

    const target = { run: (x: string) => x }
    const received: unknown[] = []
    cleanup.push('demo-ext')

    await Extension.run('demo-ext', {}, async () => ({
      default: app => {
        app.patch(target, 'run', orig => (x: string) => `${orig(x)}!`)
        app.on('demo-ext.ping', data => received.push(data))
        app.components.wrap('ToolCall', () => WrappedComp)
        app.toolViews.add('shell', ShellView)
        app.panels.add({ id: 'p1', title: 'Panel', component: PanelComp })
        app.settings.add({ id: 's1', title: 'Setting' })
        app.plus.add({ id: 'plus1', label: 'Plus', run: () => {} })
      },
    }))

    expect(target.run('ok')).toBe('ok!')
    expect(Components.ToolCall).toBe(WrappedComp)
    expect(ToolViews.shell).toBe(ShellView)
    expect(Panels.map(p => p.id)).toContain('p1')
    expect(Settings.map(s => s.id)).toContain('s1')
    expect(PlusMenu.map(i => i.id)).toContain('plus1')

    Extension.dispatch('demo-ext.ping', { n: 1 })
    expect(received).toEqual([{ n: 1 }])

    Extension.unload('demo-ext')
    expect(target.run('ok')).toBe('ok')
    expect(Components.ToolCall).toBe(BaseComp)
    expect(ToolViews.shell).toBeUndefined()
    expect(Panels.some(p => p.id === 'p1')).toBe(false)
    expect(Settings.some(s => s.id === 's1')).toBe(false)
    expect(PlusMenu.some(i => i.id === 'plus1')).toBe(false)
    expect(Loaded.some(item => item.name === 'demo-ext')).toBe(false)

    Extension.dispatch('demo-ext.ping', { n: 2 })
    expect(received).toEqual([{ n: 1 }])
  })

  test('扩展启动抛错时自动撤销已做的部分改动并记下 error，不阻断后续扩展', async () => {
    const target = { value: () => 'base' }
    cleanup.push('broken', 'healthy')

    await Extension.run('broken', {}, async () => ({
      default: app => {
        app.patch(target, 'value', () => () => 'broken')
        app.toolViews.add('read_file', { name: 'BrokenView' } as any)
        throw new Error('init failed')
      },
    }))

    await Extension.run('healthy', {}, async () => ({
      default: app => {
        app.patch(target, 'value', orig => () => `${orig()}+healthy`)
      },
    }))

    expect(target.value()).toBe('base+healthy')
    expect(ToolViews.read_file).toBeUndefined()
    expect(Loaded.find(item => item.name === 'broken')).toEqual({
      name: 'broken',
      patched: [],
      error: 'Error: init failed',
    })
    expect(Loaded.find(item => item.name === 'healthy')?.error).toBeUndefined()
  })
})
