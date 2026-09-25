/**
 * 树的装配/拆除（B 批，端到端到 cordis 与真实示例插件）：
 * 起树 → 插件装载 → 视图入真源（pluginId = 插件 id）→ 拆树 → 视图与插件表都清空。
 *
 * 说明：示例插件会调 `cmd_theme_get`（jsdom 无壳桥 → 走 catch 分支，不影响断言）；
 * 本 spec 不装 viewSync（显示侧镜像另在 viewSync.spec.ts 覆盖）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { pluginAPI } from '@worldsea/entity-core'
import { disposeWorldTree, startWorldTree, worldTreeState } from '../tree'

afterEach(() => {
  disposeWorldTree()
  pluginAPI.clearViews()
})

describe('startWorldTree / disposeWorldTree', () => {
  it('起树装载示例插件，视图进真源且 pluginId 为插件 id；拆树后全部清空', async () => {
    const handle = await startWorldTree()

    expect(handle.started).toBe(true)
    expect(handle.error).toBeNull()
    expect(handle.plugins).toContain('ws.spike.panel')

    const view = pluginAPI.getViews().find(v => v.id === 'ws-world-tree-panel')
    expect(view, '示例插件应注册视图').toBeTruthy()
    expect(view?.pluginId).toBe('ws.spike.panel')

    handle.dispose()

    const after = worldTreeState()
    expect(after.started).toBe(false)
    expect(after.plugins).toEqual([])
    expect(pluginAPI.getViews().map(v => v.id)).not.toContain('ws-world-tree-panel')
  })

  it('幂等：重复起树复用同一棵树（不重复装载）', async () => {
    const first = await startWorldTree()
    const second = await startWorldTree()
    expect(second.plugins).toEqual(first.plugins)
    expect(worldTreeState().plugins.filter(id => id === 'ws.spike.panel')).toHaveLength(1)
  })
})
