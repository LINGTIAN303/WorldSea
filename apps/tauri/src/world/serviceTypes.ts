/**
 * 世界树服务目录 · **接口声明**（从 `services.ts` 拆出，2026-11-12 批次 F）。
 *
 * 为什么拆：`services.ts` 承载到 13 项服务时已顶到 400 行硬上限（架构门禁），
 * 而每项服务都要在单文件里加接口 + 实现 + 名单三处。拆出声明后，单文件只留实现
 * 与权威名单，新增服务不再顶着容量；导入路径不变（`services.ts` 重新导出）。
 *
 * **不暴露 store 实例**：这些接口的方法可加访问控制/日志；store 实例会把内部结构
 * 钉成公共契约。**返回响应式引用而非拷贝**：`list()` 直接给 store 的响应式数组。
 */
import type { Entity, Relation, TrashItem } from '@worldsea/entity-core'
import type { entitySchemaRegistry } from '@worldsea/entity-core'
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
  /**
   * 类型的图标名（含用户图标槽位覆写，经 `getEffectiveIconOverride` 解析）。
   * 消费方：`characters` 的详情头与模板卡。
   */
  iconName(type: string): string
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
 * 详情布局服务（只读的 Tab 覆写）。
 *
 * **为什么只给「某类型的 Tab 覆写」**：`detailLayoutStore` 有 11 个导出成员，横跨
 * 载体、遮罩、字段作用域、Tab 四套互不相干的语义。插件真正消费的只有
 * 「该类型的 Tab 排序/隐藏」（`timeline` 的自绘详情页要按用户覆写排 Tab）。
 *
 * 写面（`setTabOverride` / `clearTabOverride`）刻意不给插件——那是设置面的事，
 * 插件读了照做即可；给了写面等于允许芽改用户的全局详情偏好。
 */
export interface WorldDetailLayoutService {
  /** 某实体类型的 Tab 覆写；未设返回 undefined（调用方按芽声明默认序） */
  tabOverride(entityType: string): { order?: string[]; hidden?: string[] } | undefined
}

/**
 * 回收站服务（读清单 + 三个用户动作）。
 *
 * **为什么只到「用户能做的三件事」为止**：`trashStore` 有 8 个成员，但其中
 * `add` 是**删除管线的内部写入口**（由 `entityStore.remove` 与 `useTrash` 调用，
 * 插件不该自己造回收站条目）；`restore` / `permanentDelete` 是「只动回收站、不碰
 * 磁盘与实体表」的半步操作，直接用会让恢复变成「条目消失了但实体没回来」。
 * 插件真正需要的是**完整的语义动作**，故这里只暴露 `useTrash` 的两条编排
 * （恢复含级联关系、永久删除含级联关系）+ 清空。
 *
 * 恢复后实体表/关系表需重载——那两步由调用方经 `world.entities.reload` /
 * `world.relations.reload` 完成，本服务不代劳（避免回收站服务反向依赖实体服务）。
 */
export interface WorldTrashService {
  /** 仅实体条目（列表展示用；关系条目随实体级联处理，不单独展示） */
  entityItems(): readonly TrashItem[]
  /** 条目总数（含关系条目；角标与空态判断用） */
  totalCount(): number
  /** 恢复一条实体（连同其级联关系）；条目不存在或非实体返回 false */
  restoreEntity(trashItemId: string): Promise<boolean>
  /** 永久删除一条实体（连同其级联关系），不入回收站也不可撤销 */
  permanentDeleteEntity(trashItemId: string): void
  /** 清空回收站（不可撤销） */
  emptyTrash(): void
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
  /** 时间轴默认排列方向（timeline 芽）：'horizontal' 横排，其余竖排 */
  timelineDefaultMode(): string
  /** 时间轴紧凑模式（timeline 芽） */
  timelineCompactMode(): boolean
  /** 时间轴拖拽是否启用（timeline 芽） */
  timelineDragEnabled(): boolean
  /** 时间轴默认分组（timeline 芽）：'none' 为不分组 */
  timelineDefaultGroup(): string
}

/**
 * 字体服务（只读）。
 *
 * **为什么只给「取有效字体」而不给 `prefs` 整包**：`fontPreferences` 是 6 层 × 3 字段
 * 的嵌套结构，整包暴露会把分层模型钉成公共契约；而实际消费方只用得上「某一层现在
 * 该用什么字体」（导出链的 `preview → content → 兜底` 回落也统一在此实现）。
 *
 * 无导入运行时的「字体库」侧（`world.fontLibrary`）同理：导出/预览只需条目清单。
 */
export interface WorldFontService {
  /** 某层当前字体族（`FontLayer` 之一）；未设置返回空串 */
  family(layer: 'chrome' | 'editorUi' | 'content' | 'preview' | 'canvas' | 'agent'): string
  /**
   * 导出用字体族：`preview` → `content` → 给定兜底。
   * 单点实现，避免 outline 与 manuscript 两处各写一份回落链而漂移。
   */
  exportFamily(fallback?: string): string
  /** UI 字号档位（0.85–1.15） */
  uiScale(): number
}

/** 字体库条目（只读投影：导出/预览只需要这些字段，不暴露 manifest 等内部结构）。 */
export interface WorldFontLibraryEntry {
  id: string
  family: string
  displayName: string
}

/** 字体库服务（只读）。 */
export interface WorldFontLibraryService {
  /** 全部已安装字体条目 */
  list(): WorldFontLibraryEntry[]
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