/**
 * 轻档 6 插件的取数通道守卫：视图组件读树服务，而非直连 pinia store。
 *
 * 为何用源码扫描而非挂载：要锁的是「取数通道」这一架构事实，不是渲染结果。挂载
 * `GenericEntityView` 需 pinia + i18n + 图标注册表全链路，替身环境测的是假路径。
 * 服务本身正确性由 `world/__tests__/world-services.spec.ts` 覆盖。
 */
import { describe, expect, it } from 'vitest'

/** 被测文件（相对 `world/plugins/`）。只列已迁移的；新迁移请追加。 */
const MIGRATED = [
  'organizations/OrganizationView.vue',
  'codex/CodexView.vue',
  'concepts/ConceptView.vue',
  'drawing/composables/useDrawingPersistence.ts',
  'gallery/GalleryView.vue',
  'inspiration/MoodboardView.vue',
] as const

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
  })

  it('经 getWorldService 取服务，且缺席时抛错而非静默降级', async () => {
    const code = stripComments(await readPluginFile(rel))
    expect(code).toContain('getWorldService')
    // 至少一个世界树服务名
    expect(code).toMatch(/'world\.(entities|relations)'/)
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
