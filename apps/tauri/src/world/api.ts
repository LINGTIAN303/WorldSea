/**
 * 树自持的**插件 API**（C2，2026-09-25）：插件形态 `apply(ctx, api)`，`api` 全部锁到插件 id
 * （替掉旧 `pluginAPI.currentPluginId` 全局单值那条脏路）。
 *
 * **方法名沿用旧 `PluginAPIType`**（`registerView` / `registerEntityV2` / `registerRelationV2` / `registerFacet`），
 * 故芽从 `sprouts/official/〈芽〉/index.ts` 迁入时，`activate` 的函数体可**原样搬**，只换包装头尾。
 *
 * 两条生命周期口径（与旧 PluginManager 语义对齐）：
 * - **视图与能力**：随插件卸载**自动反注册**（作者不必记）；
 * - **实体/关系类型**：卸载**不注销**（类型元数据长期可查，避免关系查询断裂）。
 *
 * 【时间轴 · 阶段 2】构造时传 `ctx` 则注册走 cordis `ctx.effect`：卸载时 LIFO 自动回卷，
 * 作者不再有「忘记登记清理」这一失败模式。不传则退回手写 cleanup 表（迁移期兼容路径，
 * 测试与未接 ctx 的调用方仍可用）。见 docs/plans/2026-11-05-阶段1A-状态归属划分.md。
 */
import { pluginAPI } from '@worldsea/entity-core'
import type {
  EntityTypeSchema,
  FacetDefinition,
  FieldSchema,
  PluginOverlay,
  PluginView,
  RelationTypeSchemaV2,
  TraitRef,
} from '@worldsea/entity-core'
import type { CordisContext } from '@deepseek-ai/cordis'

import { registerWorldCapabilities, unregisterWorldCapabilities, type WorldCapability } from '@/shell/capabilities'
import { registerPluginCleanup, unregisterViewFor } from './registry'

export interface WorldPluginApi {
  /** 注册视图（`pluginId` 锁到本插件；卸载时自动反注册） */
  registerView(view: PluginView): void
  /** 注册全局覆盖层（弹窗/抽屉类面板；打开 = `ws-open-<id>` 事件，关闭 = 组件 emit close；卸载时自动撤登记） */
  registerOverlay(overlay: PluginOverlay): void
  /** 注册实体类型（Trait V2 口径） */
  registerEntityV2(params: {
    type: string
    label: string
    icon?: string
    traits: TraitRef[]
    ownFields: FieldSchema[]
    facets?: string[]
  }): void
  /** 旧版实体类型入口（自动归一为 V2：fields → ownFields、traits 空） */
  registerEntityType(schema: EntityTypeSchema): void
  /** 注册关系类型（V2；全局已登记则跳过——沿用旧语义） */
  registerRelationV2(schema: RelationTypeSchemaV2): void
  /** 注册 Facet 定义 */
  registerFacet(facet: FacetDefinition): void
  /** 代理能力（经壳能力桥；卸载时自动撤登记） */
  capabilities: {
    register(list: WorldCapability[]): Promise<void>
  }
}

/**
 * 为一个插件造 API。
 * @param pluginId 本插件 id（闭包在内部，调用点无需传）。
 * @param ctx 插件自己的 cordis 上下文；传入则注册走 `ctx.effect`（真时间轴），缺省走 cleanup 表（兼容）。
 */
export function createPluginApi(pluginId: string, ctx?: CordisContext): WorldPluginApi {
  /**
   * 执行注册并挂上撤销逻辑。
   *
   * 有 `ctx`：把「注册 + 撤销」整体交给 `ctx.effect` —— 卸载时按 LIFO 自动执行撤销，
   * 插件作者即使忘了写清理也不会泄漏（这是相对手写 cleanup 表的根本差异）。
   * 无 `ctx`：退回 `registerPluginCleanup`（迁移期兼容，行为与阶段 2 之前一致）。
   */
  function tracked<T>(register: () => T, unregister: () => void): T {
    if (!ctx) {
      const result = register()
      registerPluginCleanup(pluginId, unregister)
      return result
    }
    // `ctx.effect` 的回调是**同步执行**的（4.1.0 实测，见 docs 阶段 1A §8.2），
    // 故此处可同步取回注册结果。若未来 upstream 改为惰性执行，`result` 会停在哨兵值——
    // 显式抛出比静默返回 undefined 更容易定位（注册结果类型多为 void，静默失败极难察觉）。
    const PENDING = Symbol('pending')
    let result: T | typeof PENDING = PENDING
    ctx.effect(() => {
      result = register()
      return unregister
    })
    if (result === PENDING) {
      throw new Error(
        `[world-tree] ctx.effect 未同步执行，注册结果不可用（pluginId=${pluginId}）；` +
          '上游 cordis 的 effect 执行时机可能已变，需复核 api.ts 的 tracked()',
      )
    }
    return result
  }

  return {
    registerView(view: PluginView) {
      tracked(
        () => pluginAPI.withPluginScope(pluginId, () => pluginAPI.registerView(view)),
        () => { unregisterViewFor(pluginId, view.id) },
      )
    },
    registerOverlay(overlay: PluginOverlay) {
      tracked(
        () => pluginAPI.withPluginScope(pluginId, () => pluginAPI.registerOverlay(overlay)),
        () => { pluginAPI.unregisterOverlay(overlay.id) },
      )
    },
    // 实体/关系/Facet 类型**有意不注销**（类型元数据长期可查，关系查询会引用），故不走 tracked。
    registerEntityV2(params) {
      pluginAPI.withPluginScope(pluginId, () => pluginAPI.registerEntityV2(params))
    },
    registerEntityType(schema: EntityTypeSchema) {
      // 与 PluginAPI.registerEntityType 的「自动包装为 V2」同口径
      pluginAPI.withPluginScope(pluginId, () =>
        pluginAPI.registerEntityV2({
          type: schema.typeKey,
          label: schema.label,
          icon: schema.icon,
          traits: [],
          ownFields: schema.fields || [],
        }),
      )
    },
    registerRelationV2(schema: RelationTypeSchemaV2) {
      pluginAPI.withPluginScope(pluginId, () => pluginAPI.registerRelationV2(schema))
    },
    registerFacet(facet: FacetDefinition) {
      pluginAPI.withPluginScope(pluginId, () => pluginAPI.registerFacet(facet))
    },
    capabilities: {
      async register(list: WorldCapability[]) {
        await registerWorldCapabilities(list)
        const ids = list.map(capability => capability.id)
        const unregister = () => {
          void unregisterWorldCapabilities(ids).catch((error: unknown) => {
            console.error(`[world-tree] 能力撤登记失败（${pluginId}）：`, error)
          })
        }
        // 登记是异步的；撤销本身同步发起（内部 catch），故可直接交给 effect。
        if (ctx) ctx.effect(() => unregister)
        else registerPluginCleanup(pluginId, unregister)
      },
    },
  }
}
