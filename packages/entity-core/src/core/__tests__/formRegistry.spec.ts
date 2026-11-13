/**
 * 表现形式贡献位（第 6 贡献位）契约测试。
 *
 * 背景：这套注册表原是 `outline` 私有的（`board/forms/registry.ts`），2026-11-13 提升为
 * 平台贡献位（`@worldsea/entity-core/core` 的 `formRegistry` + `PluginAPI.registerForm`）。
 * 提升要成立，必须验四件事：
 *   1. 幂等：同 id 重复注册跳过后到者（插件重载是常态，不能抛错）
 *   2. 可反注册：`unregister` 后查不到
 *   3. **按插件回卷**：插件卸载时它登记的形式全部消失（这是「贡献位」与「全局单例」的区别）
 *   4. 订阅可用：显示侧能收到增删事件（镜像渲染的前提）
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { formRegistry, resolveFormConfig } from '@worldsea/entity-core/core'
import type { FormDefinition } from '@worldsea/entity-core/core'

/** 造一个最小可用的形式定义（component 用占位对象，本测试不渲染）。 */
function fakeForm(form: string, overrides: Partial<FormDefinition> = {}): FormDefinition {
  return {
    form,
    label: `形式-${form}`,
    icon: 'list',
    kind: 'inline',
    defaultHeight: 100,
    defaultConfig: { a: 1, arr: ['x'] },
    configSchema: [{ key: 'a', label: 'A', type: 'number', default: 1 }],
    component: { render: () => null } as unknown as FormDefinition['component'],
    ...overrides,
  }
}

beforeEach(() => {
  formRegistry.clear()
})

describe('表现形式注册表（平台第 6 贡献位）', () => {
  it('幂等注册：同 form 先到者生效，不抛错', () => {
    formRegistry.register(fakeForm('title', { label: '第一次' }))
    formRegistry.register(fakeForm('title', { label: '第二次' }))
    expect(formRegistry.getAll()).toHaveLength(1)
    expect(formRegistry.get('title')?.label).toBe('第一次')
  })

  it('可反注册：unregister 后查不到，再注册可恢复', () => {
    formRegistry.register(fakeForm('card'))
    expect(formRegistry.get('card')).toBeDefined()
    expect(formRegistry.unregister('card')).toBe(true)
    expect(formRegistry.get('card')).toBeUndefined()
    // 反注册不存在的返回 false（不抛错）
    expect(formRegistry.unregister('card')).toBe(false)
    formRegistry.register(fakeForm('card'))
    expect(formRegistry.get('card')).toBeDefined()
  })

  it('按插件回卷：只撤该插件登记的那些（这是「贡献位」与全局单例的本质区别）', () => {
    formRegistry.register({ ...fakeForm('a'), pluginId: 'official.outline' })
    formRegistry.register({ ...fakeForm('b'), pluginId: 'official.outline' })
    formRegistry.register({ ...fakeForm('c'), pluginId: 'official.other' })

    const removed = formRegistry.unregisterByPlugin('official.outline')

    expect(removed).toBe(2)
    expect(formRegistry.get('a')).toBeUndefined()
    expect(formRegistry.get('b')).toBeUndefined()
    // 别的插件的形式不受影响
    expect(formRegistry.get('c')).toBeDefined()
  })

  it('按 kind 过滤：derived / inline 分开取', () => {
    formRegistry.register(fakeForm('t1', { kind: 'inline' }))
    formRegistry.register(fakeForm('t2', { kind: 'derived' }))
    expect(formRegistry.getByKind('inline').map(d => d.form)).toEqual(['t1'])
    expect(formRegistry.getByKind('derived').map(d => d.form)).toEqual(['t2'])
  })

  it('订阅：注册 / 反注册都派发事件，退订后不再收到', () => {
    const seen: string[] = []
    const off = formRegistry.onChange(c => seen.push(`${c.kind}:${c.form.form}`))

    formRegistry.register(fakeForm('x'))
    formRegistry.unregister('x')
    expect(seen).toEqual(['registered:x', 'unregistered:x'])

    off()
    formRegistry.register(fakeForm('y'))
    expect(seen).toEqual(['registered:x', 'unregistered:x'])
  })

  it('监听器抛错被隔离，不影响注册本身', () => {
    formRegistry.onChange(() => {
      throw new Error('故意抛错')
    })
    expect(() => formRegistry.register(fakeForm('z'))).not.toThrow()
    expect(formRegistry.get('z')).toBeDefined()
  })

  it('resolveFormConfig：默认值打底 + 覆盖 + 缺键兜底，且数组不共享引用', () => {
    formRegistry.register(fakeForm('cfg'))

    // 默认值生效
    expect(resolveFormConfig('cfg')).toEqual({ a: 1, arr: ['x'] })
    // 覆盖生效
    expect(resolveFormConfig('cfg', { a: 9 })).toEqual({ a: 9, arr: ['x'] })

    // 数组必须复制：改返回值不得污染注册表默认值（否则多个容器共享同一引用）
    const first = resolveFormConfig('cfg')
    ;(first.arr as string[]).push('污染')
    expect(resolveFormConfig('cfg').arr).toEqual(['x'])

    // 未知形式返回空对象（不抛错）
    expect(resolveFormConfig('nope')).toEqual({})
  })
})
