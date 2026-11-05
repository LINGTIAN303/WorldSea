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
import { availablePlugins, disposeWorldTree, setPluginEnabled, startWorldTree, unloadPlugin, worldTreeContext, worldTreeState, WORLD_SERVICES } from '../tree'
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

  it('availablePlugins 保留 manifest 的 domain / secondaryDomains（R1/R2 数据 API）', async () => {
    const domainPlugin: WorldPlugin = {
      manifest: {
        id: 'ws.fake.domain',
        name: '域测试',
        version: '1.0.0',
        description: 'R1/R2 数据 API 测试',
        domain: 'life',
        secondaryDomains: ['society'],
      },
      apply() {},
    }
    await startWorldTree({ plugins: [domainPlugin] })
    const manifest = availablePlugins().find(plugin => plugin.manifest.id === 'ws.fake.domain')?.manifest
    expect(manifest?.domain).toBe('life')
    expect(manifest?.secondaryDomains).toEqual(['society'])
  })

  it('拆树回收 root 级 effect（服务初始化等直接挂在 root 上的注册）', async () => {
    const handle = await startWorldTree({ plugins: [] })
    const ctx = worldTreeContext()
    expect(ctx, '起树后应拿到上下文').toBeTruthy()

    let rootEffectDisposed = false
    ctx!.effect(() => () => {
      rootEffectDisposed = true
    })

    expect(rootEffectDisposed, '拆树前不应回收').toBe(false)

    handle.dispose()
    // `fiber.dispose()` 是异步的（fire-and-forget，与既有的拆 fiber 同口径）
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(rootEffectDisposed, '拆树后 root 级 effect 应被回收').toBe(true)
  })

  it('拆树后服务已撤（world.info 不可取）', async () => {
    const handle = await startWorldTree({ plugins: [] })
    const ctx = worldTreeContext()!
    expect(ctx.get('world.info', false), '起树后应可取到 world.info').toBeTruthy()

    handle.dispose()
    await new Promise(resolve => setTimeout(resolve, 50))

    // 服务由 `drops` 撤（与 root dispose 双保险）；此处锁「拆树后确实取不到」。
    // 注意：这条不单独区分 drops 与 root dispose 的功劳，二者互为兜底——
    // 「root 级 effect 回收」由下一条用例单独锁定。
    expect(ctx.get('world.info', false), '拆树后 world.info 应不可取').toBeFalsy()
  })
})

describe('阶段 2 · 插件 API 走 ctx.effect（时间轴）', () => {
  /** 只用 `api` 注册、完全不写 cleanup 的插件——迁移后的标准形态。 */
  const effectOnlyPlugin: WorldPlugin = {
    manifest: { id: 'ws.fake.effect', name: '仅 effect 插件', version: '1.0.0', description: '阶段 2 试点' },
    apply(_ctx, api) {
      api.registerView({ id: 'effect-view', label: 'effect 视图', icon: 'bulb', component: {} as never })
    },
  }

  it('插件不写 cleanup，卸载后视图仍被回收（effect 自动回卷）', async () => {
    const handle = await startWorldTree({ plugins: [effectOnlyPlugin] })
    expect(pluginAPI.getViews().map(v => v.id), '装载后视图应在真源').toContain('effect-view')

    handle.dispose()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(pluginAPI.getViews().map(v => v.id), '卸载后视图应被 effect 回卷').not.toContain('effect-view')
  })

  /**
   * 锁定「注册确实走了 ctx.effect」——不是只锁最终效果。
   *
   * 原因：旧 cleanup 表路径与 effect 路径在**最终结果**上等价（视图都会被撤），
   * 单看结果无法区分两条路径。真正的差异是**撤销顺序**：
   * effect 走 LIFO（后注册先撤），cleanup 表走 FIFO（按登记顺序正序撤）。
   * 故用「两个 view 的撤回顺序」作为路径判据。
   */
  it('注册走 ctx.effect：撤销顺序为 LIFO（旧 cleanup 表是 FIFO）', async () => {
    const order: string[] = []
    const spyPlugin: WorldPlugin = {
      manifest: { id: 'ws.fake.order', name: '顺序探针', version: '1.0.0', description: 'LIFO 判据' },
      apply(_ctx, api) {
        // 先 A 后 B；LIFO 回卷应为 B→A
        api.registerView({ id: 'order-a', label: 'A', icon: 'bulb', component: {} as never })
        api.registerView({ id: 'order-b', label: 'B', icon: 'bulb', component: {} as never })
      },
    }

    const handle = await startWorldTree({ plugins: [spyPlugin] })
    // 通过监听真源变更记录撤回顺序
    const originalUnregister = pluginAPI.unregisterView.bind(pluginAPI)
    ;(pluginAPI as unknown as { unregisterView: (id: string) => boolean }).unregisterView = (id: string) => {
      if (id === 'order-a' || id === 'order-b') order.push(id)
      return originalUnregister(id)
    }

    handle.dispose()
    await new Promise(resolve => setTimeout(resolve, 50))

    ;(pluginAPI as unknown as { unregisterView: typeof originalUnregister }).unregisterView = originalUnregister

    expect(order, '两个视图都应被撤回').toHaveLength(2)
    expect(order, 'LIFO：后注册的 B 先撤，A 后撤').toEqual(['order-b', 'order-a'])
  })

  it('真启停（setPluginEnabled 关/开）走 effect 回卷，视图不进幽灵态', async () => {
    await startWorldTree({ plugins: [effectOnlyPlugin] })
    expect(pluginAPI.getViews().map(v => v.id)).toContain('effect-view')

    setPluginEnabled('ws.fake.effect', false)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(pluginAPI.getViews().map(v => v.id), '停用后视图应撤回').not.toContain('effect-view')

    setPluginEnabled('ws.fake.effect', true)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(pluginAPI.getViews().map(v => v.id), '重新启用后视图应重新注册').toContain('effect-view')
  })

  it('试点 official.field-matrix 形态：单视图芽经 effect 注册与回卷', async () => {
    // 不 import 真插件：其 `FieldMatrixView.vue` 会连带拉起重依赖（见文件头注），
    // 在 vitest 并行下超时。此处按 field-matrix 的**形态**复刻：单视图 + 无 cleanup + 真实 manifest id。
    const fieldMatrixLike: WorldPlugin = {
      manifest: {
        id: 'official.field-matrix',
        name: '字段矩阵',
        version: '1.0.0',
        description: '试点形态复刻',
        domain: 'tool',
        entityTypes: [],
        kind: 'sprout',
      },
      apply(_ctx, api) {
        api.registerView({ id: 'field-matrix', label: '字段矩阵', icon: 'grid', component: {} as never, toolbar: 'bar' })
      },
    }

    const handle = await startWorldTree({ plugins: [fieldMatrixLike] })
    const target = pluginAPI.getViews().find(v => v.id === 'field-matrix')
    expect(target, 'field-matrix 视图应注册').toBeTruthy()
    expect(target?.pluginId, '归属应为插件 id').toBe('official.field-matrix')

    handle.dispose()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(pluginAPI.getViews().map(v => v.id), '拆树后应撤回').not.toContain('field-matrix')
  })
})

describe('阶段 2-B · 服务目录在树内可被 ctx.get 取到', () => {
  it('全部服务就位，且插件可经 inject 声明依赖', async () => {
    let seen: Record<string, unknown> = {}
    const probe: WorldPlugin = {
      manifest: {
        id: 'ws.fake.services',
        name: '服务探针',
        version: '1.0.0',
        description: '阶段 2-B 探针',
        requires: ['world.entities', 'world.relations', 'world.schema'],
      },
      apply(ctx) {
        seen = {
          entities: ctx.get('world.entities', false),
          relations: ctx.get('world.relations', false),
          schema: ctx.get('world.schema', false),
          project: ctx.get('world.project', false),
          views: ctx.get('world.views', false),
        }
      },
    }

    await startWorldTree({ plugins: [probe] })
    const ctx = worldTreeContext()!

    // 遍历权威名单而非硬编码列表：新增服务自动被覆盖，不会漏测
    for (const name of WORLD_SERVICES) {
      expect(ctx.get(name, false), `${name} 应在树内可取`).toBeTruthy()
    }
    expect(seen.entities, '插件 apply 内经 ctx.get 应拿到实体服务').toBeTruthy()
    expect(seen.schema, '插件 apply 内经 ctx.get 应拿到 schema 服务').toBeTruthy()
  })

  it('拆树后全部服务撤除', async () => {
    const handle = await startWorldTree({ plugins: [] })
    const ctx = worldTreeContext()!

    handle.dispose()
    await new Promise(resolve => setTimeout(resolve, 50))

    for (const name of WORLD_SERVICES) {
      expect(ctx.get(name, false), `${name} 拆树后应不可取`).toBeFalsy()
    }
  })
})
