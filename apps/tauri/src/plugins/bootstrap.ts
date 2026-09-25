// 轻量芽启动装配（Phase C 迁移：替代 web governor 编排）
import { pluginManager } from './PluginManager'
import { installViewSynchronizer } from './viewSync'
import { usePluginStore } from '@worldsea/entity-core'
import { registerWorldviewSprout } from '@agent/index'
import { useUIStore } from '../stores/uiStore'

/** 已迁移芽（第一批：characters/regions/concepts/items；第二批：timeline/organizations/culture/conflict/inspiration/apparel/outline/manuscript/drawing/notebook；第三批：WASM 布局类 12 个） */
const MIGRATED_SPROUT_IDS = new Set([
  // 第一批
  'official.characters', 'official.regions', 'official.concepts', 'official.items',
  // 第二批（轻芽）
  'official.timeline', 'official.organizations', 'official.culture', 'official.conflict',
  'official.inspiration', 'official.apparel', 'official.outline', 'official.manuscript',
  'official.drawing', 'official.notebook',
  // 第三批（WASM 布局类）
  'official.graph', 'official.mindmap', 'official.species', 'official.languages',
  'official.plants', 'official.magic', 'official.weapons', 'official.combat_stats',
  'official.buildings', 'official.tactical-board', 'official.workflow',
  'official.custom',
])

/** 已迁移芽的静态 loader */
const sproutLoaders: Record<string, () => Promise<any>> = {
  'official.characters': () => import('../sprouts/official/characters/index'),
  'official.regions': () => import('../sprouts/official/regions/index'),
  'official.concepts': () => import('../sprouts/official/concepts/index'),
  'official.items': () => import('../sprouts/official/items/index'),
  'official.timeline': () => import('../sprouts/official/timeline/index'),
  'official.organizations': () => import('../sprouts/official/organizations/index'),
  'official.culture': () => import('../sprouts/official/culture/index'),
  'official.conflict': () => import('../sprouts/official/conflict/index'),
  'official.inspiration': () => import('../sprouts/official/inspiration/index'),
  'official.apparel': () => import('../sprouts/official/apparel/index'),
  'official.outline': () => import('../sprouts/official/outline/index'),
  'official.manuscript': () => import('../sprouts/official/manuscript/index'),
  'official.drawing': () => import('../sprouts/official/drawing/index'),
  'official.notebook': () => import('../sprouts/official/notebook/index'),
  'official.graph': () => import('../sprouts/official/graph/index'),
  'official.mindmap': () => import('../sprouts/official/mindmap/index'),
  'official.species': () => import('../sprouts/official/species/index'),
  'official.languages': () => import('../sprouts/official/languages/index'),
  'official.plants': () => import('../sprouts/official/plants/index'),
  'official.magic': () => import('../sprouts/official/magic/index'),
  'official.weapons': () => import('../sprouts/official/weapons/index'),
  'official.combat_stats': () => import('../sprouts/official/combat_stats/index'),
  'official.buildings': () => import('../sprouts/official/buildings/index'),
  'official.tactical-board': () => import('../sprouts/official/tactical-board/index'),
  'official.workflow': () => import('../sprouts/official/workflow/index'),
  'official.custom': () => import('../sprouts/official/custom/index'),
}

export interface BootstrapOptions {
  /** 跳过「默认选中首个视图」：切项目重播种时不应打断当前视图选择 */
  skipDefaultView?: boolean
}

export async function bootstrapSprouts(opts?: BootstrapOptions): Promise<void> {
  // 1. 预注册所有实体类型元数据（关系查询不断裂）
  pluginManager.preRegisterAllEntityTypes()

  // 2. 视图生命周期装配：真源（pluginAPI）派发 → pluginStore（侧栏）+ uiStore 顺序 自动镜像
  installViewSynchronizer()
  const pluginStore = usePluginStore()

  // 3. 加载并激活已迁移芽；同时登记进世界观芽工具（worldview）
  //    ——「芽名随已有芽的注册」的实现：id 为稳定键、name/description 实时取登记值，
  //    改芽名（manifest.name）或增删芽（MIGRATED_SPROUT_IDS），工具侧自动跟随。
  const loaded = await Promise.all(
    Array.from(MIGRATED_SPROUT_IDS).map(async id => ({ id, instance: await sproutLoaders[id]() })),
  )
  for (const p of loaded) {
    await pluginManager.activate(p.instance)
    const manifest = p.instance?.manifest
    if (manifest?.id && manifest?.name) {
      registerWorldviewSprout({
        id: manifest.id,
        name: manifest.name,
        description: manifest.description || '',
      })
    }
  }

  // 4. 若尚无视图选中（Agent 是首项），默认选中第一个芽视图（切项目重播种时跳过）
  const uiStore = useUIStore()
  if (!opts?.skipDefaultView && pluginStore.views.length > 0 && !uiStore.currentView) {
    uiStore.setView(pluginStore.views[0].id)
    uiStore.viewComponent = pluginStore.views[0].component
  }
}
