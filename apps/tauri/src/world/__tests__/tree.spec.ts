/**
 * 树的装配/拆除（B/C 批，机制层）：起树 → 插件装载（**注入假插件**）→ 视图入真源
 * （pluginId = 插件 id）→ 拆树 → 视图与插件表都清空。
 *
 * 【为什么注入假插件】真实插件图含 `mind-elixir` 等重依赖，动态导入在 vitest 并行下 >35s
 * （曾致全量门禁假红）；本 spec 只测**机制**，真实插件图的装载路径由
 * `loader.spec.ts`（清单/预检，轻）与真机探针（`__WS_WORLD_TREE__`）覆盖。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { pluginAPI } from '@worldsea/entity-core'
import { disposeWorldTree, setPluginEnabled, startWorldTree, unloadPlugin, worldTreeState } from '../tree'
import { registerPluginCleanup, registerViewFor, unregisterViewFor } from '../registry'
import type { WorldPlugin } from '../manifest'

const VIEW_ID = 'fake-view'
const PLUGIN_ID = 'ws.fake.one'

const fakePlugin: WorldPlugin = {
  manifest: { id: PLUGIN_ID, name: '假插件', version: '1.0.0', description: '机制测试用' },
  apply(ctx) {
    const info = ctx.get('world.info', false) as { name?: string } | null
    if (!info?.name) throw new Error('world.info 服务未注入')
    registerViewFor(PLUGIN_ID, { id: VIEW_ID, label: '假视图', icon: 'bulb', component: {} as never })
    registerPluginCleanup(PLUGIN_ID, () => {
      unregisterViewFor(PLUGIN_ID, VIEW_ID)
    })
  },
}

afterEach(() => {
  disposeWorldTree()
  pluginAPI.clearViews()
})

describe('startWorldTree / disposeWorldTree', () => {
  it('起树装载插件，视图进真源且 pluginId 为插件 id；拆树后全部清空', async () => {
    const handle = await startWorldTree({ plugins: [fakePlugin] })

    expect(handle.started).toBe(true)
    expect(handle.error).toBeNull()
    expect(handle.plugins).toEqual([PLUGIN_ID])

    const view = pluginAPI.getViews().find(v => v.id === VIEW_ID)
    expect(view, '插件应注册视图').toBeTruthy()
    expect(view?.pluginId).toBe(PLUGIN_ID)

    handle.dispose()

    const after = worldTreeState()
    expect(after.started).toBe(false)
    expect(after.plugins).toEqual([])
    expect(pluginAPI.getViews().map(v => v.id)).not.toContain(VIEW_ID)
  })

  it('幂等：重复起树复用同一棵树（不重复装载）', async () => {
    const first = await startWorldTree({ plugins: [fakePlugin] })
    const second = await startWorldTree({ plugins: [fakePlugin] })
    expect(second.plugins).toEqual(first.plugins)
    expect(worldTreeState().plugins).toHaveLength(1)
  })

  it('插件 apply 抛错 → 记进 handle.error 之外的 rejected 面不炸全局（隔离由装载器负责，这里锁状态可读）', async () => {
    const broken: WorldPlugin = {
      manifest: { id: 'ws.fake.broken', name: '坏插件', version: '1.0.0', description: '抛错用' },
      apply() {
        throw new Error('装载期故障')
      },
    }
    // cordis 会把 apply 抛错留给自身 fiber（不冒泡到 startWorldTree 的 try 之外）
    const handle = await startWorldTree({ plugins: [broken] })
    expect(handle.started).toBe(true)
    expect(handle.plugins).toContain('ws.fake.broken')
  })

  it('卸载后立即重装（项目切换 reinitializeModules 的背靠背序列）→ 视图仍应在真源', async () => {
    await startWorldTree({ plugins: [fakePlugin] })
    expect(pluginAPI.getViews().map(v => v.id)).toContain(VIEW_ID)

    unloadPlugin(PLUGIN_ID)
    setPluginEnabled(PLUGIN_ID, true)

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(worldTreeState().plugins).toContain(PLUGIN_ID)
    expect(pluginAPI.getViews().map(v => v.id), '重装后视图应重新注册').toContain(VIEW_ID)
  })
})
