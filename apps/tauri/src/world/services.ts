/**
 * 第二棵树的**服务目录**（阶段 2-B，2026-11-05）。
 *
 * 职责：把「应用侧共享态」包装成 cordis 服务，供树内插件经 `ctx.get(name)` 使用。
 *
 * 三条口径（见 docs/plans/2026-11-05-阶段1B-服务目录设计.md）：
 * - **服务名复数**（`world.entities`）= 一类东西的集合；能力 id 单数.方法（`world.entity.list`）
 *   是同一实现的桥接暴露——两侧语义同构，未来合并成一棵树时可零改造退化。
 * - **暴露方法表，不暴露 store 实例**：方法可加访问控制/日志，store 实例会把内部结构钉成公共契约。
 * - **返回响应式引用而非拷贝**：`list()` 直接给 store 的响应式数组，保持既有性能假设
 *   （96 个文件直访 `useEntityStore` 时就是这么用的）。
 *
 * 命名空间：本树服务一律 `world.`；dsh 侧为 `dsh-*`，天然分域。
 */
import {
  entitySchemaRegistry,
  getProjectManager,
  pluginAPI,
  useEntityStore,
  useDetailLayoutStore,
  useRelationStore,
  useSettingsStore,
  useTrash,
  useTrashStore,
  useUIStore,
} from '@worldsea/entity-core'
import { useFontStore } from '@worldsea/entity-core/stores/fontStore'
import { useFontLibraryStore } from '@worldsea/font-kit'
import type { Entity, Relation } from '@worldsea/entity-core'
import {
  registerPackSerializer,
  registerProjectExtraProvider,
} from '@worldsea/entity-core/core'

// 接口声明拆到 `serviceTypes.ts`（单文件曾顶到 400 行硬上限，见该文件头注）。
// 这里**既要 import 也要 re-export**：`export type {...} from` 只把名字转出去、
// 不在本地建绑定，而下面的 `satisfies` 子句要用到这些类型。
import type {
  WorldEntitiesService,
  WorldRelationsService,
  WorldSchemaService,
  WorldProjectService,
  WorldViewsService,
  WorldUiService,
  WorldDetailLayoutService,
  WorldTrashService,
  WorldSettingsService,
  WorldFontService,
  WorldFontLibraryService,
  WorldProjectExtrasService,
} from './serviceTypes'

export type {
  WorldEntitiesService,
  WorldRelationsService,
  WorldSchemaService,
  WorldProjectService,
  WorldViewsService,
  WorldUiService,
  WorldDetailLayoutService,
  WorldTrashService,
  WorldSettingsService,
  WorldFontService,
  WorldFontLibraryEntry,
  WorldFontLibraryService,
  WorldProjectExtrasService,
} from './serviceTypes'

/**
 * 构建全部服务实现（每次起树调一次）。
 *
 * **注意**：这些是**读时绑定**——store 由 pinia 惰性创建，故在方法体内调用 `useEntityStore()`
 * 而非在构建时取一次，避免起树早于 pinia 初始化的顺序依赖。
 */
export function createWorldServices(): Record<string, unknown> {
  return {
    // 树元信息（原有服务；并入本目录以便「新增服务只改一处」）
    'world.info': { name: 'WorldSea', tree: 'world', mode: 'browser' },

    'world.entities': {
      list: () => useEntityStore().entities,
      get: (id: string) => useEntityStore().entityMap.get(id),
      byType: (type: string) => useEntityStore().entities.filter(e => e.type === type),
      add: (entity: Entity, source?: 'user' | 'agent' | 'import', opts?: { skipUndo?: boolean }) =>
        useEntityStore().add(entity, source, opts),
      update: (id: string, changes: Partial<Entity>, source?: 'user' | 'agent' | 'import', opts?: { skipUndo?: boolean }) =>
        useEntityStore().update(id, changes, source, opts),
      remove: (id: string, source?: 'user' | 'agent' | 'import', opts?: { skipUndo?: boolean }) =>
        useEntityStore().remove(id, source, opts),
      reload: () => useEntityStore().loadAll(),
      loadByType: (type: string) => useEntityStore().loadByType(type),
      getAll: () => useEntityStore().getAllEntities(),
    } satisfies WorldEntitiesService,

    'world.relations': {
      list: () => useRelationStore().relations,
      byEntity: (entityId: string) =>
        useRelationStore().relations.filter(r => r.sourceId === entityId || r.targetId === entityId),
      loadByEntity: (entityId: string) => useRelationStore().loadByEntity(entityId),
      add: (relation: Relation, source?: 'user' | 'agent' | 'import', opts?: { skipUndo?: boolean }) =>
        useRelationStore().add(relation, source, opts),
      update: (id: string, changes: Partial<Relation>, opts?: { skipUndo?: boolean }) =>
        useRelationStore().update(id, changes, opts),
      remove: (id: string, source?: 'user' | 'agent' | 'import', opts?: { skipUndo?: boolean }) =>
        useRelationStore().remove(id, source, opts),
      reload: () => useRelationStore().loadAll(),
      getAll: () => useRelationStore().getAllRelations(),
    } satisfies WorldRelationsService,

    'world.schema': {
      list: () => entitySchemaRegistry.getAll(),
      get: (type: string) => entitySchemaRegistry.get(type),
      label: (type: string) => entitySchemaRegistry.getLabel(type),
      iconName: (type: string) => entitySchemaRegistry.getIconName(type),
    } satisfies WorldSchemaService,

    'world.project': {
      current: async () => {
        const manager = getProjectManager()
        const id = manager.getCurrentProjectId()
        const info = id ? await manager.getCurrentProject() : undefined
        return {
          id: id ?? null,
          name: info?.name ?? null,
          dirPath: info?.dirPath ?? null,
          isDefault: info?.isDefault ?? null,
        }
      },
    } satisfies WorldProjectService,

    'world.views': {
      list: () =>
        pluginAPI.getViews().map(view => ({
          id: view.id,
          label: view.label,
          pluginId: view.pluginId ?? null,
          toolbar: view.toolbar ?? 'bar',
        })),
    } satisfies WorldViewsService,

    // 只转发已证实被消费的字段（见 `WorldSettingsService` 注释）。
    'world.settings': {
      panelLimitEnabled: () => useSettingsStore().panelLimitEnabled,
      autoCreateEntityEnabled: () => useSettingsStore().autoCreateEntityEnabled,
      autoCreateEntityRefEnabled: () => useSettingsStore().autoCreateEntityRefEnabled,
      autoCreateSelectorEnabled: () => useSettingsStore().autoCreateSelectorEnabled,
      graphBackgroundMode: () => useSettingsStore().graphBackgroundMode,
      // timeline 芽（2026-11-12 随批次 F 加）：调用方原本写 `(settingsStore as any).xxx`，
      // 但四个键在 entity-core 的 settingsStore 中都是有类型声明的 persistedRef，服务给回正类型。
      timelineDefaultMode: () => useSettingsStore().timelineDefaultMode,
      timelineCompactMode: () => useSettingsStore().timelineCompactMode,
      timelineDragEnabled: () => useSettingsStore().timelineDragEnabled,
      timelineDefaultGroup: () => useSettingsStore().timelineDefaultGroup,
    } satisfies WorldSettingsService,

    // 导航意图（不含组件对象，见 `WorldUiService` 注释）。
    'world.ui': {
      navigateTo: (viewId: string) => useUIStore().setView(viewId),
      currentView: () => useUIStore().currentView || null,
      selectedEntityId: () => useUIStore().selectedEntityId,
      selectEntity: (id: string | null) => useUIStore().selectEntity(id),
      setSettingsTarget: (target: { section: string } | null) => {
        useUIStore().settingsTarget = target as never
      },
      setJumpBackViewId: (viewId: string | null) => {
        useUIStore()._jumpBackViewId = viewId
      },
    } satisfies WorldUiService,

    // 字体：只给「取有效字体」，不给 prefs 整包（见 `WorldFontService` 注释）。
    'world.font': {
      family: (layer: 'chrome' | 'editorUi' | 'content' | 'preview' | 'canvas' | 'agent') =>
        useFontStore().prefs[layer].family,
      exportFamily: (fallback = 'Microsoft YaHei') => {
        const prefs = useFontStore().prefs
        return prefs.preview.family || prefs.content.family || fallback
      },
      uiScale: () => useFontStore().uiScale,
    } satisfies WorldFontService,

    'world.fontLibrary': {
      list: () =>
        useFontLibraryStore().getAllEntries().map(entry => ({
          id: entry.id,
          family: entry.family,
          displayName: entry.displayName,
        })),
    } satisfies WorldFontLibraryService,

    // 三个用户动作走 useTrash 的编排（含级联关系），不暴露 store 的 add（见 `WorldTrashService`）。
    'world.trash': {
      entityItems: () => useTrashStore().entityItems,
      totalCount: () => useTrashStore().totalCount,
      restoreEntity: (trashItemId: string) => useTrash().restoreEntity(trashItemId),
      permanentDeleteEntity: (trashItemId: string) => useTrash().permanentDeleteEntity(trashItemId),
      emptyTrash: () => useTrashStore().emptyTrash(),
    } satisfies WorldTrashService,

    // 只读的 Tab 覆写；写面归设置面（见 `WorldDetailLayoutService`）。
    'world.detailLayout': {
      tabOverride: (entityType: string) => useDetailLayoutStore().tabOverrides[entityType],
    } satisfies WorldDetailLayoutService,

    // 直通 entity-core 的两个全局注册面；返回值即 disposer，插件交给 `ctx.effect` 即可回卷。
    'world.projectExtras': {
      registerPackSerializer,
      registerProjectExtraProvider,
    } satisfies WorldProjectExtrasService,
  }
}

/** 本树提供的全部服务名（`manifest.requires` 预检的权威名单）。 */
export const WORLD_SERVICE_NAMES: readonly string[] = [
  'world.info',
  'world.entities',
  'world.relations',
  'world.schema',
  'world.project',
  'world.views',
  'world.settings',
  'world.ui',
  'world.font',
  'world.fontLibrary',
  'world.trash',
  'world.detailLayout',
  'world.projectExtras',
]
