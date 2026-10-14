/**
 * PluginAPI 覆盖层（overlay）真源生命周期（批2）：登记/反注册/清空的事件派发、
 * pluginId 作用域锁定、监听器抛错隔离——模式对齐 pluginViewLifecycle.spec（view 侧）。
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { pluginAPI } from '../PluginAPI'
import type { PluginOverlay, OverlayChange } from '../../types'

function makeOverlay(id: string, component: unknown = {}): PluginOverlay {
  return { id, label: id, component: component as PluginOverlay['component'] }
}

afterEach(() => {
  pluginAPI.clearOverlays()
})

describe('pluginAPI / 覆盖层真源（批2）', () => {
  it('登记 → registered 事件 + 真源可读；重复 id 幂等（不重复派发）', () => {
    const changes: OverlayChange[] = []
    const off = pluginAPI.onOverlayChange(change => changes.push(change))

    pluginAPI.registerOverlay(makeOverlay('trash'))
    pluginAPI.registerOverlay(makeOverlay('trash'))

    expect(pluginAPI.getOverlays()).toHaveLength(1)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'registered', overlay: { id: 'trash' } })
    off()
  })

  it('withPluginScope 锁定 pluginId（覆盖 pluginAPI.currentPluginId 全局单值污染）', () => {
    pluginAPI.withPluginScope('official.data-tools', () => {
      pluginAPI.registerOverlay(makeOverlay('trash'))
    })
    pluginAPI.withPluginScope('other.plugin', () => {
      pluginAPI.registerOverlay(makeOverlay('artifacts'))
    })

    const byId = new Map(pluginAPI.getOverlays().map(o => [o.id, o]))
    expect(byId.get('trash')?.pluginId).toBe('official.data-tools')
    expect(byId.get('artifacts')?.pluginId).toBe('other.plugin')
  })

  it('反注册 → unregistered 事件；不存在 id 返回 false 且不派发', () => {
    const changes: OverlayChange[] = []
    const off = pluginAPI.onOverlayChange(change => changes.push(change))
    pluginAPI.registerOverlay(makeOverlay('trash'))

    expect(pluginAPI.unregisterOverlay('trash')).toBe(true)
    expect(pluginAPI.unregisterOverlay('trash')).toBe(false)
    expect(pluginAPI.getOverlays()).toHaveLength(0)
    expect(changes.map(c => c.kind)).toEqual(['registered', 'unregistered'])
    off()
  })

  it('clearOverlays 逐条派发反注册（拆树/项目切换兜底）', () => {
    pluginAPI.registerOverlay(makeOverlay('a'))
    pluginAPI.registerOverlay(makeOverlay('b'))
    const changes: OverlayChange[] = []
    pluginAPI.onOverlayChange(change => changes.push(change))

    pluginAPI.clearOverlays()
    expect(pluginAPI.getOverlays()).toHaveLength(0)
    expect(changes.map(c => c.kind)).toEqual(['unregistered', 'unregistered'])
  })

  it('监听器抛错隔离：单个监听器炸不影响其余监听器与登记本身', () => {
    const boom = vi.fn(() => { throw new Error('boom') })
    const ok = vi.fn()
    pluginAPI.onOverlayChange(boom)
    pluginAPI.onOverlayChange(ok)

    expect(() => pluginAPI.registerOverlay(makeOverlay('trash'))).not.toThrow()
    expect(boom).toHaveBeenCalledTimes(1)
    expect(ok).toHaveBeenCalledTimes(1)
  })

  it('退订后不再收到事件', () => {
    const listener = vi.fn()
    const off = pluginAPI.onOverlayChange(listener)
    off()
    pluginAPI.registerOverlay(makeOverlay('trash'))
    expect(listener).not.toHaveBeenCalled()
  })
})
