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

/** 为一个插件造 API（每次装载造一份；`pluginId` 闭包在内部，调用点无需传）。 */
export function createPluginApi(pluginId: string): WorldPluginApi {
  return {
    registerView(view: PluginView) {
      pluginAPI.withPluginScope(pluginId, () => pluginAPI.registerView(view))
      registerPluginCleanup(pluginId, () => {
        unregisterViewFor(pluginId, view.id)
      })
    },
    registerOverlay(overlay: PluginOverlay) {
      pluginAPI.withPluginScope(pluginId, () => pluginAPI.registerOverlay(overlay))
      registerPluginCleanup(pluginId, () => {
        pluginAPI.unregisterOverlay(overlay.id)
      })
    },
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
        registerPluginCleanup(pluginId, () => {
          void unregisterWorldCapabilities(ids).catch((error: unknown) => {
            console.error(`[world-tree] 能力撤登记失败（${pluginId}）：`, error)
          })
        })
      },
    },
  }
}
