/**
 * 已迁移插件的取数通道守卫：视图/composable 读树服务，而非直连 pinia store。
 *
 * 为何用源码扫描而非挂载：要锁的是「取数通道」这一架构事实，不是渲染结果。挂载
 * `GenericEntityView` 需 pinia + i18n + 图标注册表全链路，替身环境测的是假路径。
 * 服务本身正确性由 `world/__tests__/world-services.spec.ts` 覆盖。
 */
import { describe, expect, it } from 'vitest'

import { WORLD_SERVICE_NAMES } from '../../services'

/** 被测文件（相对 `world/plugins/`）。只列已迁移的；新迁移请追加。 */
const MIGRATED = [
  // 轻档
  'organizations/OrganizationView.vue',
  'codex/CodexView.vue',
  'concepts/ConceptView.vue',
  'drawing/composables/useDrawingPersistence.ts',
  'gallery/GalleryView.vue',
  'inspiration/MoodboardView.vue',
  // 中档（成对结构：composable 供数 + View 承载）
  'buildings/composables/useBuildingSectionData.ts',
  'buildings/BuildingSectionView.vue',
  'languages/composables/useLangFamilyTreeData.ts',
  'languages/LanguageFamilyTreeView.vue',
  'magic/composables/useSkillTreeData.ts',
  'magic/SkillTreeView.vue',
  'plants/composables/useRecipeTreeData.ts',
  'plants/RecipeTreeView.vue',
  'species/composables/useEvolutionTreeData.ts',
  'species/EvolutionTreeView.vue',
  'weapons/composables/useWeaponLineageData.ts',
  'weapons/WeaponLineageView.vue',
  // 中档剩余（可直接推、不需新服务）
  'combat_stats/composables/useRealmStaircaseData.ts',
  'combat_stats/RealmStaircaseView.vue',
  'culture/composables/useFestivalCalendarData.ts',
  'culture/FestivalCalendarView.vue',
  'orchestration/composables/usePipeline.ts',
  'orchestration/composables/usePipelineTemplates.ts',
  // 补 world.settings 后解锁
  'graph/composables/useGraphView.ts',
  'field-matrix/composables/useAutoLinkObserver.ts',
  // 重档（无服务缺口，10 文件全量迁移）
  'notebook/NotebookView.vue',
  'notebook/components/NotebookBoard.vue',
  'notebook/components/NotebookEditor.vue',
  'notebook/components/NotebookGraph.vue',
  'notebook/components/sourceAutocomplete.ts',
  'notebook/composables/editorExtensions.ts',
  'notebook/composables/noteLinkExt.ts',
  'notebook/composables/useNoteEditor.ts',
  'notebook/backlinkDerive.ts',
  'notebook/serviceAccess.ts',
  // 补 world.ui 后解锁
  'custom/DashboardView.vue',
  'custom/serviceAccess.ts',
  'theme-editor/ThemeEditorPro.vue',
  'theme-editor/ThemeEditorQuick.vue',
  'theme-editor/serviceAccess.ts',
  'mindmap/MindmapView.vue',
  'mindmap/serviceAccess.ts',
  // 补 world.font / world.fontLibrary 后解锁
  'outline/board/export/exportRunner.ts',
  'outline/serviceAccess.ts',
  'manuscript/components/PhonePreview.vue',
  'manuscript/composables/useManuscriptExport.ts',
  'manuscript/serviceAccess.ts',
  // 补 world.trash 后解锁
  'data-tools/TrashPanel.vue',
  'data-tools/ConsistencyReportPanel.vue',
  'data-tools/serviceAccess.ts',
] as const

/**
 * 经共享取值器取数的文件：它们自身只 `import { xSvc } from './serviceAccess'`，
 * 服务名与 throw 都收敛在 `serviceAccess.ts`（单份）。故这些文件只断言「不直连 store
 * + 确实引用共享取值器」，服务名校验交给对应 `serviceAccess.ts` 那一例。
 */
const VIA_SHARED_ACCESSOR = new Set([
  'notebook/NotebookView.vue',
  'notebook/components/NotebookBoard.vue',
  'notebook/components/NotebookEditor.vue',
  'notebook/components/NotebookGraph.vue',
  'notebook/components/sourceAutocomplete.ts',
  'notebook/composables/editorExtensions.ts',
  'notebook/composables/noteLinkExt.ts',
  'notebook/composables/useNoteEditor.ts',
  'notebook/backlinkDerive.ts',
  'custom/DashboardView.vue',
  'theme-editor/ThemeEditorPro.vue',
  'theme-editor/ThemeEditorQuick.vue',
  'mindmap/MindmapView.vue',
  'outline/board/export/exportRunner.ts',
  'manuscript/components/PhonePreview.vue',
  'manuscript/composables/useManuscriptExport.ts',
  'data-tools/TrashPanel.vue',
  'data-tools/ConsistencyReportPanel.vue',
])

async function readPluginFile(rel: string): Promise<string> {
  const { readFileSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  // 本文件在 world/plugins/__tests__/ 下
  const here = dirname(fileURLToPath(import.meta.url))
  return readFileSync(join(here, '..', rel), 'utf8')
}

/** 去注释再扫描：注释里提到 store 名不算违规。 */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe.each(MIGRATED)('%s 取数经服务', rel => {
  it('不导入也不调用 pinia store', async () => {
    const code = stripComments(await readPluginFile(rel))
    expect(code).not.toContain('useEntityStore')
    expect(code).not.toContain('useRelationStore')
    expect(code).not.toMatch(/\bentityStore\b/)
    expect(code).not.toMatch(/\brelationStore\b/)
    // 中档插件沿用短别名 es / rs，同样不能再出现
    expect(code).not.toMatch(/\bes\.(entities|loadAll|add|update|remove)\b/)
    expect(code).not.toMatch(/\brs\.(relations|loadAll|add|update|remove)\b/)
  })

  it('经服务取数（直接 getWorldService，或引用共享取值器），服务名在权威名单内', async () => {
    const code = stripComments(await readPluginFile(rel))
    if (VIA_SHARED_ACCESSOR.has(rel)) {
      // 服务名与 throw 收敛在 serviceAccess.ts（下面单独一例覆盖），此处只验它确实经该模块取数
      expect(code).toMatch(/from '(\.\.?\/)+serviceAccess'/)
      return
    }
    // 允许两种写法：直接 getWorldService<T>('name')，或经本地 svcOf 包装后传字面量
    expect(code).toMatch(/getWorldService|svcOf/)
    // 服务名必须真实存在：只匹配 'world.xxx' 会放过拼错的名字（如 world.settingsXX）
    const used = [...code.matchAll(/'((?:world)\.[a-zA-Z.]+)'/g)].map(m => m[1]!)
    expect(used.length).toBeGreaterThan(0)
    for (const name of used) {
      expect(WORLD_SERVICE_NAMES, `拼错或未登记的服务名：${name}`).toContain(name)
    }
  })

  it('服务缺席时抛错而非静默降级', async () => {
    if (VIA_SHARED_ACCESSOR.has(rel)) return // 由 serviceAccess.ts 那一例覆盖
    const code = stripComments(await readPluginFile(rel))
    // 守卫必须 throw：静默返回会让「时序被破坏」表现成「列表莫名是空的」
    expect(code).toMatch(/if \(!svc\) throw new Error\(/)
  })
})

describe('服务目录已补齐组件层所需的方法', () => {
  it('world.entities 暴露 loadByType（drawing 需要增量按类型重载）', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, '..', '..', 'services.ts'), 'utf8')
    // 接口声明 + 实现各一处
    expect(src).toMatch(/loadByType\(type: string\): Promise<void>/)
    expect(src).toMatch(/loadByType: \(type: string\) => useEntityStore\(\)\.loadByType\(type\)/)
  })
})
