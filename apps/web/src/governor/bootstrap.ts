/** governor 启动配置：声明式模块注册，critical/normal/lazy 三级分层（顺序保证见文档），详细见 docs/details/注释/web/governor/bootstrap.md */
import type { ModuleDescriptor } from './types'
import { officialPluginsToDescriptors } from './adapters'
import { OFFICIAL_PLUGINS } from '@/plugins/plugin-manifest'

/* ════════════════════════════════════════
   critical 模块：基础设施
   ════════════════════════════════════════ */

/** 项目空间初始化（必须早于其他所有初始化，原 App.vue 逻辑见文档），详细见 docs/details/注释/web/governor/bootstrap.md */
const projectSpaceModule: ModuleDescriptor = {
  id: 'core.project-space',
  name: '项目空间',
  version: '1.0.0',
  priority: 'critical',
  requires: ['db'],
  defaultActive: true,
  description: '项目空间初始化与实体数据加载',

  activate: async () => {
    const { useProjectSwitcher } = await import('@/composables/useProjectSwitcher')
    const projectSwitcher = useProjectSwitcher()
    await projectSwitcher.initialize()

    // 初始化完成后加载实体数据
    const { useEntityStore } = await import('@worldsmith/entity-core')
    const entityStore = useEntityStore()
    await entityStore.loadAll()
  },
}

/**
 * WASM 可用性检测。
 *
 * 原 App.vue 逻辑：
 *   checkWasmAvailability().catch(() => {})
 *
 * 异步检测，不阻塞。作为 critical 模块确保在后端使用前触发检测，
 * 但不 await 结果（WASM 加载可能耗时，不应阻塞启动流程）。
 */
const wasmDetectionModule: ModuleDescriptor = {
  id: 'core.wasm-detection',
  name: 'WASM 检测',
  version: '1.0.0',
  priority: 'critical',
  defaultActive: true,
  description: 'WASM 可用性检测，设置后端类型（异步，不阻塞）',

  activate: async () => {
    const { checkWasmAvailability } = await import('@/core/worldsmithCore')
    // 异步检测，不 await 结果，不阻止启动
    // WASM 加载可能耗时，原设计就是不阻塞首屏
    checkWasmAvailability().catch(() => {})
  },
}

/**
 * 插件预注册。
 *
 * 原 App.vue 逻辑：
 *   pluginManager.preRegisterAllEntityTypes()
 *
 * 全局预注册所有实体类型元数据，确保关系查询不断裂。
 */
const pluginPreRegisterModule: ModuleDescriptor = {
  id: 'core.plugin-pre-register',
  name: '插件预注册',
  version: '1.0.0',
  priority: 'critical',
  requires: ['ui-render'],
  defaultActive: true,
  description: '预注册所有官方插件的实体类型元数据',

  activate: async () => {
    const { pluginManager } = await import('@/plugins/PluginManager')
    pluginManager.preRegisterAllEntityTypes()

    // 设置视图钩子（原 App.vue 逻辑）
    const { usePluginStore, pluginAPI } = await import('@worldsmith/entity-core')
    const { useUIStore } = await import('@/stores/uiStore')
    const pluginStore = usePluginStore()

    pluginManager.setViewHook((viewId: string) => {
      const view = pluginAPI.getViews().find(v => v.id === viewId)
      if (view) {
        pluginStore.registerView(view)
      }
      const uiStore = useUIStore()
      uiStore.ensureViewInOrder(viewId)
    })
  },
}

/* ════════════════════════════════════════
   normal 模块：核心功能
   ════════════════════════════════════════ */

/** 官方插件加载（静态 import 映射替代 @vite-ignore 原因见文档），详细见 docs/details/注释/web/governor/bootstrap.md */
const MIGRATED_OFFICIAL_PLUGIN_IDS = new Set<string>([
  // P3-W4 首批
  'official.characters',
  'official.regions',
  'official.organizations',
  'official.concepts',
  'official.items',
  'official.languages',
  // P3-W4 第二批
  'official.buildings',
  'official.species',
  'official.plants',
  'official.combat_stats',
  'official.weapons',
  'official.apparel',
  'official.conflict',
  // P3-W4 第三批
  'official.timeline',
  'official.magic',
  'official.outline',
  'official.custom',
  'official.culture',
  'official.inspiration',
  // P3-W4 第四批
  'official.drawing',
  'official.tactical-board',
  'official.notebook',
  'official.graph',
  // P3-W5 第八批（manuscript/mindmap/workflow）
  'official.manuscript',
  'official.mindmap',
  'official.workflow',
  // P3-W5 第九批（最后一个官方插件）
  'official.module-builder',
])

/** 已迁移插件的静态 loader（id → import 模块），Vite 构建期静态分析 */
const pluginLoaders: Record<string, () => Promise<any>> = {
  // P3-W4 首批
  'official.characters': () => import('@/plugins/official/characters/index'),
  'official.regions': () => import('@/plugins/official/regions/index'),
  'official.organizations': () => import('@/plugins/official/organizations/index'),
  'official.concepts': () => import('@/plugins/official/concepts/index'),
  'official.items': () => import('@/plugins/official/items/index'),
  'official.languages': () => import('@/plugins/official/languages/index'),
  // P3-W4 第二批
  'official.buildings': () => import('@/plugins/official/buildings/index'),
  'official.species': () => import('@/plugins/official/species/index'),
  'official.plants': () => import('@/plugins/official/plants/index'),
  'official.combat_stats': () => import('@/plugins/official/combat_stats/index'),
  'official.weapons': () => import('@/plugins/official/weapons/index'),
  'official.apparel': () => import('@/plugins/official/apparel/index'),
  'official.conflict': () => import('@/plugins/official/conflict/index'),
  // P3-W4 第三批
  'official.timeline': () => import('@/plugins/official/timeline/index'),
  'official.magic': () => import('@/plugins/official/magic/index'),
  'official.outline': () => import('@/plugins/official/outline/index'),
  'official.custom': () => import('@/plugins/official/custom/index'),
  'official.culture': () => import('@/plugins/official/culture/index'),
  'official.inspiration': () => import('@/plugins/official/inspiration/index'),
  // P3-W4 第四批
  'official.drawing': () => import('@/plugins/official/drawing/index'),
  'official.tactical-board': () => import('@/plugins/official/tactical-board/index'),
  'official.notebook': () => import('@/plugins/official/notebook/index'),
  'official.graph': () => import('@/plugins/official/graph/index'),
  // P3-W5 第八批
  'official.manuscript': () => import('@/plugins/official/manuscript/index'),
  'official.mindmap': () => import('@/plugins/official/mindmap/index'),
  'official.workflow': () => import('@/plugins/official/workflow/index'),
  // P3-W5 第九批（最后一个官方插件）
  'official.module-builder': () => import('@/plugins/official/module-builder/index'),
}

const officialPluginsModule: ModuleDescriptor = {
  id: 'core.official-plugins',
  name: '官方插件加载',
  version: '1.0.0',
  priority: 'normal',
  requires: ['ui-render'],
  defaultActive: true,
  description: '加载并激活所有已启用的官方插件（P3-W4 首批 6 个）',

  activate: async () => {
    const { pluginManager } = await import('@/plugins/PluginManager')
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const { usePluginStore } = await import('@worldsmith/entity-core')
    const { useUIStore } = await import('@/stores/uiStore')

    const settingsStore = useSettingsStore()
    const activeIds = settingsStore.getActivePluginIds()

    // 并行加载模块（仅已迁移且已启用的插件）
    const loadPromises = activeIds
      .filter(id => MIGRATED_OFFICIAL_PLUGIN_IDS.has(id) && pluginLoaders[id])
      .map(async id => {
        const mod = await pluginLoaders[id]()
        return { id, instance: mod }
      })

    const loadedPlugins = await Promise.all(loadPromises)

    // 顺序激活，尽早设置首屏视图
    const pluginStore = usePluginStore()
    const uiStore = useUIStore()
    let firstViewSet = false

    for (const p of loadedPlugins) {
      await pluginManager.activate(p.instance)
      // 每激活一个插件就检查是否已有视图可显示
      if (!firstViewSet && pluginStore.views.length > 0) {
        uiStore.setView(pluginStore.views[0].id)
        uiStore.viewComponent = pluginStore.views[0].component
        firstViewSet = true
      }
    }

    // 兜底：如果所有插件激活完仍无视图
    if (!firstViewSet && pluginStore.views.length > 0) {
      uiStore.setView(pluginStore.views[0].id)
      uiStore.viewComponent = pluginStore.views[0].component
    }
  },
}

/**
 * 关系初始化。
 *
 * 原 App.vue 逻辑：
 *   import('@worldsmith/entity-core/relations').then(m => {
 *     return import('@worldsmith/entity-core').then(m2 => m2.syncToLegacyRegistry())
 *   })
 */
const relationsInitModule: ModuleDescriptor = {
  id: 'core.relations-init',
  name: '关系初始化',
  version: '1.0.0',
  priority: 'normal',
  requires: ['db'],
  defaultActive: true,
  description: '初始化全局关系定义并同步到旧版注册表',

  activate: async () => {
    await import('@worldsmith/entity-core/relations')
    const m2 = await import('@worldsmith/entity-core')
    await m2.syncToLegacyRegistry()
  },
}

// ⏳ P3-W4 恢复：Facet 迁移（依赖 core/FacetMigrator，未迁入 apps/web）
// const facetMigrationModule: ModuleDescriptor = { ... }

/** Facet 迁移（原 App.vue 逻辑与恢复说明见文档），详细见 docs/details/注释/web/governor/bootstrap.md */
const facetMigrationModule: ModuleDescriptor = {
  id: 'core.facet-migration',
  name: 'Facet 迁移',
  version: '1.0.0',
  priority: 'normal',
  requires: ['db'],
  defaultActive: true,
  description: '迁移旧版 weapon/apparel 实体到 item facet',

  activate: async () => {
    const { migrateWeaponApparelToItemFacet } = await import('@/core/FacetMigrator')
    const report = await migrateWeaponApparelToItemFacet()
    if (!report.skipped) {
      console.info('[Governor] Facet 迁移完成:', report)
    }
  },
}

/**
 * 自定义模块系统初始化。
 *
 * 原 App.vue 逻辑：
 *   Promise.all([
 *     import('./modules/store').then(m => m.moduleStore.migrateFromLocalStorage()),
 *     import('./modules/registry').then(m => m.moduleRegistry.initialize()),
 *   ])
 */
const customModulesModule: ModuleDescriptor = {
  id: 'core.custom-modules',
  name: '自定义模块',
  version: '1.0.0',
  priority: 'normal',
  requires: ['db', 'ui-render'],
  defaultActive: true,
  description: '加载并激活自定义模块系统',

  activate: async () => {
    const { moduleStore } = await import('@/modules/store')
    const { moduleRegistry } = await import('@/modules/registry')

    await moduleStore.migrateFromLocalStorage()
    await moduleRegistry.initialize()
  },
}

/**
 * 全局导航事件监听。
 *
 * 原 App.vue 逻辑：
 *   window.addEventListener('ws-navigate', ((e: CustomEvent) => { ... }) as EventListener)
 */
const navigationListenerModule: ModuleDescriptor = {
  id: 'core.navigation-listener',
  name: '导航事件监听',
  version: '1.0.0',
  priority: 'normal',
  requires: ['ui-render'],
  defaultActive: true,
  description: '注册全局 ws-navigate 事件监听器',

  activate: async () => {
    const { usePluginStore } = await import('@worldsmith/entity-core')
    const { useUIStore } = await import('@/stores/uiStore')

    window.addEventListener('ws-navigate', ((e: CustomEvent) => {
      const { view: viewId, entityId } = e.detail
      const store = usePluginStore()
      const ui = useUIStore()
      const view = store.getView(viewId)
      if (view) {
        ui.setView(viewId)
        ui.viewComponent = view.component
        if (entityId) {
          ui.selectEntity(entityId)
        }
      }
    }) as EventListener)
  },
}

/* ════════════════════════════════════════
   lazy 模块：延迟加载
   ════════════════════════════════════════ */

// ⏳ P3-W4 恢复：字体预设加载（依赖 composables/useFontBootstrap，未迁入 apps/web）
// const fontBootstrapModule: ModuleDescriptor = { ... }

/** 字体预设加载（原 App.vue requestIdleCallback 逻辑见文档），详细见 docs/details/注释/web/governor/bootstrap.md */
const fontBootstrapModule: ModuleDescriptor = {
  id: 'core.font-bootstrap',
  name: '字体预设',
  version: '1.0.0',
  priority: 'lazy',
  requires: ['ui-render'],
  defaultActive: true,
  description: '字体预设加载（空闲时执行）',

  activate: async () => {
    const { useFontBootstrap } = await import('@/composables/useFontBootstrap')
    const { bootstrap: fontBootstrap } = useFontBootstrap()

    // 使用 requestIdleCallback 延迟加载
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => fontBootstrap())
    } else {
      setTimeout(() => fontBootstrap(), 200)
    }
  },
}

/**
 * 自动清理。
 *
 * 原 App.vue 逻辑：
 *   const { runIfNeeded: runAutoCleanup } = useAutoCleanup()
 *   runAutoCleanup()
 */
const autoCleanupModule: ModuleDescriptor = {
  id: 'core.auto-cleanup',
  name: '自动清理',
  version: '1.0.0',
  priority: 'lazy',
  requires: ['db'],
  defaultActive: true,
  description: '自动清理过期/无效数据',

  activate: async () => {
    const { useAutoCleanup } = await import('@worldsmith/entity-core/composables')
    const { runIfNeeded: runAutoCleanup } = useAutoCleanup()
    await runAutoCleanup()
  },
}

/* ════════════════════════════════════════
   统一导出
   ════════════════════════════════════════ */

/**
 * 所有核心模块描述符（critical + normal + lazy）。
 *
 * 官方插件通过 officialPluginsToDescriptors 单独转换，
 * 在 bootstrap 中作为 normal 批次的一部分注册。
 *
 * 注意：P3-W3 裁剪版不含 officialPluginsModule（官方插件未迁），
 * P3-W4 恢复时在此加入。
 */
export const coreModules: ModuleDescriptor[] = [
  // ── critical ──
  projectSpaceModule,
  wasmDetectionModule,
  pluginPreRegisterModule,

  // ── normal ──
  officialPluginsModule,
  relationsInitModule,
  facetMigrationModule,
  customModulesModule,
  navigationListenerModule,

  // ── lazy ──
  fontBootstrapModule,
  autoCleanupModule,
]

/**
 * 获取所有模块描述符（核心模块 + 官方插件描述符）。
 *
 * 注意：官方插件的实际加载由 officialPluginsModule 聚合处理，
 * 这里返回的官方插件描述符仅用于注册表展示和未来细粒度控制。
 * P3-W3 阶段官方插件未迁，此函数返回的官方描述符仅作占位（不实际激活）。
 */
export function getAllModuleDescriptors(): ModuleDescriptor[] {
  const officialDescriptors = officialPluginsToDescriptors(OFFICIAL_PLUGINS)
  return [...coreModules, ...officialDescriptors]
}
