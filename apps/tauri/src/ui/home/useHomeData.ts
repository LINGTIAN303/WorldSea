/**
 * 首页数据组合器（Task 6b）：只做 store 装配与装载等待，聚合交给 `buildHomeData` 纯函数。
 *
 * - 装载：等启动就绪（bootState 离开 booting）→ 等实体/关系 store 的首次 loading 结束；
 *   空 store 且文件后端已就绪才兜底 `loadAll()`；
 * - Schema 口径：类型表每次聚合时重建，并以 `fieldRegistry.version` 建立响应式依赖——
 *   否则首屏（schema 尚未注册）算一次就被 Vue 永久缓存，冷启动最近动态/域计数恒空；
 * - 视图口径：取全量可见视图（`allVisibleViewsInSidebarOrder`）——首页是全局页，
 *   不受侧栏 split 模式的当前域过滤收窄；
 * - 聚合：projectName / profile / entities / relations / sprouts / plugins / matrix 等快照输入。
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  entitySchemaRegistry,
  fieldRegistry,
  useEntityStore,
  useRelationStore,
  useSettingsStore,
  useUIStore,
} from '@worldsea/entity-core'
import { getFileStorageBackend } from '@worldsea/entity-core/core'
// readLastViewId 只从 stores 子路径导出（entity-core 根入口未聚合），与 useHomeNavigation 同源
import { readLastViewId } from '@worldsea/entity-core/stores/uiStore'
import { availablePlugins } from '@/world'
import { pluginEntityTypes } from '@/ui/layout/sidebar/sproutEntityCounts'
import { allVisibleViewsInSidebarOrder } from '@/ui/layout/sidebar/viewOrder'
import { useFieldMatrixData } from '@/world/plugins/field-matrix/composables/useFieldMatrixData'
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'
import { useHomeProfileStore } from '@/stores/homeProfileStore'
import { buildHomeData, type HomeData } from './homeData'

/** 等待响应式标志回到 false（用于等 store 的首次装载结束）。 */
export function waitUntilIdle(read: () => boolean): Promise<void> {
  if (!read()) return Promise.resolve()
  return new Promise(resolve => {
    const stop = watch(read, value => {
      if (!value) {
        stop()
        resolve()
      }
    })
  })
}

export type HomeLoadGate = 'wait-boot' | 'boot-error' | 'load' | 'read-only'

/**
 * 首页装载门（纯函数，便于单测）。
 * - `wait-boot`：启动仍在 booting——此刻 store 可能还是空的、文件后端未绑定项目目录；
 * - `boot-error`：启动失败，直接进错误态，不再空转等待；
 * - `load`：启动就绪且文件后端已绑定——允许空 store 兜底 `loadAll()`；
 * - `read-only`：启动就绪但文件后端未就绪（浏览器预览等）——只用内存态，不兜底拉取。
 */
export function homeLoadGate(bootState: 'booting' | 'ready' | 'error', backendReady: boolean): HomeLoadGate {
  if (bootState === 'booting') return 'wait-boot'
  if (bootState === 'error') return 'boot-error'
  return backendReady ? 'load' : 'read-only'
}

export function useHomeData() {
  const entityStore = useEntityStore()
  const relationStore = useRelationStore()
  const settingsStore = useSettingsStore()
  const ui = useUIStore()
  const project = useProjectSwitcher()
  const profileStore = useHomeProfileStore()
  const matrix = useFieldMatrixData()
  const bootstrapped = ref(false)
  const loading = computed(() => !bootstrapped.value)
  const error = ref<string | null>(null)

  const projectName = computed(() => {
    const p = project.currentProject.value
    return p?.isDefault ? '默认工作区' : (p?.name || '默认工作区')
  })

  const data = computed<HomeData | null>(() => {
    if (!bootstrapped.value) return null
    // 依赖模式注册表版本号：entitySchemaRegistry / fieldRegistry 是普通 Map + 一个 ref 版本号，
    // 不读 version 就建立不起响应式依赖——首屏（挂载早于 installWorldTree）会把空表永久缓存。
    void fieldRegistry.version.value
    const typeMeta = new Map(
      entitySchemaRegistry.getAll().map(s => [s.typeKey, { label: s.label, icon: s.icon ?? 'entity', pluginId: s.pluginId }]),
    )
    return buildHomeData({
      projectName: projectName.value,
      profile: profileStore.profile,
      entities: entityStore.entities,
      relations: relationStore.relations,
      sprouts: settingsStore.sprouts,
      plugins: availablePlugins(),
      visibleViews: allVisibleViewsInSidebarOrder(),
      pluginTypes: pluginEntityTypes(),
      typeMeta,
      matrix: matrix.model.value,
      preferredViewId: ui.currentView ?? readLastViewId(),
    })
  })

  async function ensureLoaded() {
    try {
      // 首页先于 `projectSwitcher.initialize()` 挂载：bootState 还是 booting 时，
      // 文件后端没绑定项目目录，任何 loadAll 都可能读到旧 fallback，并让 bootstrapShell
      // 误判「已有数据」而跳过真实项目装载。故先等启动结束。
      if (ui.bootState === 'booting') await waitUntilIdle(() => ui.bootState === 'booting')

      const gate = homeLoadGate(ui.bootState, getFileStorageBackend()?.isReady ?? false)
      if (gate === 'boot-error') {
        error.value = '启动未完成，暂时无法读取世界数据'
        return
      }
      if (entityStore.loading) await waitUntilIdle(() => entityStore.loading)
      if (gate === 'load' && !entityStore.entities.length) await entityStore.loadAll()
      if (relationStore.loading) await waitUntilIdle(() => relationStore.loading)
      if (gate === 'load' && !relationStore.relations.length) await relationStore.loadAll()
      error.value = entityStore.error
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      bootstrapped.value = true
    }
  }

  async function reload() {
    bootstrapped.value = false
    error.value = null
    await ensureLoaded()
  }

  onMounted(ensureLoaded)
  return { data, loading, error, reload }
}
