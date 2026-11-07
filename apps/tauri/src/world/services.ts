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
  useRelationStore,
  useSettingsStore,
  useUIStore,
} from '@worldsea/entity-core'
import type { Entity, Relation } from '@worldsea/entity-core'
import {
  registerPackSerializer,
  registerProjectExtraProvider,
} from '@worldsea/entity-core/core'
import type { ProjectExtraProvider, Serializer } from '@worldsea/entity-core/core'

/** 实体服务的读写面（对应能力 `world.entity.*`）。 */
export interface WorldEntitiesService {
  /** 全部实体（响应式引用，非拷贝） */
  list(): readonly Entity[]
  /** 按 id 取（读 store 的内存索引，不解 IO） */
  get(id: string): Entity | undefined
  /** 按类型取 */
  byType(type: string): readonly Entity[]
  /**
   * 新建；返回新实体 id。
   * @param opts.skipUndo Agent/系统类批量写入应传 true——这类写入若进撤销栈，
   *   会迅速填满上限（默认 20）并挤掉用户真实操作的历史。用户交互写入不要传。
   */
  add(entity: Entity, source?: 'user' | 'agent' | 'import', opts?: { skipUndo?: boolean }): Promise<string>
  /** 局部更新（`opts.skipUndo` 语义同 add） */
  update(
    id: string,
    changes: Partial<Entity>,
    source?: 'user' | 'agent' | 'import',
    opts?: { skipUndo?: boolean },
  ): Promise<void>
  /** 删除（同时清理关联关系；`opts.skipUndo` 语义同 add） */
  remove(id: string, source?: 'user' | 'agent' | 'import', opts?: { skipUndo?: boolean }): Promise<void>
  /** 全量重载（外部改动后对账用） */
  reload(): Promise<void>
  /**
   * 按类型从磁盘重载（**增量语义**：该类型整体替换并同步删除，其它类型原样保留）。
   *
   * 与 `byType()` 的区别：`byType` 只读内存（不碰 IO），本方法会读磁盘。
   * 视图首次进入、或怀疑该类型内存态过期时用它；日常读列表用 `byType`。
   */
  loadByType(type: string): Promise<void>
}

/** 关系服务的读写面（对应能力 `world.relation.*`）。 */
export interface WorldRelationsService {
  list(): readonly Relation[]
  /** 与某实体相关的关系（读 store 内存态；不从磁盘重载） */
  byEntity(entityId: string): readonly Relation[]
  /** 从磁盘重载某实体的关系（增量语义：只替换涉及该实体的条目） */
  loadByEntity(entityId: string): Promise<void>
  add(relation: Relation, source?: 'user' | 'agent' | 'import', opts?: { skipUndo?: boolean }): Promise<string>
  /** 注意：relationStore.update 不接受 source（与 entityStore 不同），但支持 skipUndo */
  update(id: string, changes: Partial<Relation>, opts?: { skipUndo?: boolean }): Promise<void>
  remove(id: string, source?: 'user' | 'agent' | 'import', opts?: { skipUndo?: boolean }): Promise<void>
  reload(): Promise<void>
}

/** 类型 schema 服务（对应能力 `world.schema.*`）。 */
export interface WorldSchemaService {
  /** 全部已登记类型 */
  list(): ReturnType<typeof entitySchemaRegistry.getAll>
  /** 按 typeKey 取 */
  get(type: string): ReturnType<typeof entitySchemaRegistry.get>
  /** 类型的中文标签（含 fallback） */
  label(type: string): string
}

/** 项目服务（对应能力 `world.project.*`）。 */
export interface WorldProjectService {
  current(): Promise<{ id: string | null; name: string | null; dirPath: string | null; isDefault: boolean | null }>
}

/** 视图服务（只读；对应能力 `world.views.list`）。 */
export interface WorldViewsService {
  list(): Array<{ id: string; label: string; pluginId: string | null; toolbar: string }>
}

/**
 * 界面导航服务（跨视图跳转 + 设置落点）。
 *
 * **为什么不暴露组件对象**：`uiStore.viewComponent` 是 `currentView` 的派生缓存，
 * 已收进 `uiStore.showView()` 内部维护（见该函数注释）。这里只暴露**导航意图**——
 * 插件说「去哪」，组件由 `ViewContainer` 自行解析，不跨服务传 `Component`。
 *
 * 故本服务**没有** `showView(view)`，只有 `navigateTo(viewId)`：`custom` 芽原本写
 * `showView(pluginStore.getView(id))`，改造后改为 `navigateTo(id)`——行为等价
 * （`ViewContainer` 有按 `currentView` 解析组件的兜底，且有 watch 自动补齐缓存）。
 */
export interface WorldUiService {
  /** 切换当前视图（按 id；不传组件，由 ViewContainer 解析） */
  navigateTo(viewId: string): void
  /** 当前视图 id（响应式读取） */
  currentView(): string | null
  /** 跨视图跳转的选中挂起位（目标视图挂载时读回） */
  selectedEntityId(): string | null
  /** 写选中挂起位 */
  selectEntity(id: string | null): void
  /** 打开设置后的落点（theme-editor 芽用） */
  setSettingsTarget(target: { section: string } | null): void
  /** 自定义视窗的「返回」目标视图 id（custom 芽写，视图容器读） */
  setJumpBackViewId(viewId: string | null): void
}

/**
 * 用户偏好读取服务（只读）。
 *
 * **为什么只暴露具名字段而不转发整个 store**：`settingsStore` 对外有 40+ 项
 * （模型密钥、自定义 provider、AI 端点等），整包暴露等于把 store 的内部结构钉成
 * 公共契约，且会让插件顺手读到不该读的配置。这里只列**已证实被插件消费**的字段，
 * 新增字段必须伴随真实消费者一起加。
 *
 * 全部为响应式引用读取：方法内取 store 当前值，故在 `computed` 里调用可正常追踪。
 */
export interface WorldSettingsService {
  /** 自定义视窗的面板数量上限是否启用（custom 芽） */
  panelLimitEnabled(): boolean
  /** AutoLink 三态开关（field-matrix 芽） */
  autoCreateEntityEnabled(): boolean
  autoCreateEntityRefEnabled(): boolean
  autoCreateSelectorEnabled(): boolean
  /** 全局图谱背景模式（graph 芽）：'theme' 跟随主题，其余按深色 */
  graphBackgroundMode(): string
}

/**
 * 项目迁移扩展点服务（对应 entity-core 的两个全局注册表）。
 *
 * **为什么它是一个服务**：`registerPackSerializer` / `registerProjectExtraProvider` 是
 * 应用级全局注册面，插件的 `apply` 必须依赖它才能把「随项目迁移的配置」接进导出/导入链。
 * 这是目前**唯一在 `apply` 层真实被消费的应用能力**（时间线芽用它接历法与分区）。
 *
 * 两个方法都返回 disposer，插件可交给 `ctx.effect` 实现卸载回卷。
 */
export interface WorldProjectExtrasService {
  registerPackSerializer(serializer: Serializer): () => void
  registerProjectExtraProvider(provider: ProjectExtraProvider): () => void
}

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
    } satisfies WorldRelationsService,

    'world.schema': {
      list: () => entitySchemaRegistry.getAll(),
      get: (type: string) => entitySchemaRegistry.get(type),
      label: (type: string) => entitySchemaRegistry.getLabel(type),
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
  'world.projectExtras',
]
