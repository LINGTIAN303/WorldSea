/**
 * 阶段 3 试点守卫：`regions` 视图的取数经树服务，而非直连 pinia store。
 *
 * 为什么用源码扫描而不是挂载组件：
 * 本用例要锁的是「取数通道」这一架构事实，不是渲染结果。挂载 SFC 需要 `GenericEntityView`
 * 全链路（它又依赖 pinia / i18n / 图标注册表），造出来的假环境测的是替身而非真路径。
 * 扫描能直接证明「组件里不再出现 store 直访、且确实调用了服务方法」，判别力更强。
 *
 * 服务本身的正确性由 `world/__tests__/world-services.spec.ts` 覆盖，此处不重复。
 */
import { describe, expect, it } from 'vitest'

/**
 * 用本文件位置定位源码，而不是 `process.cwd()`：测试可能在仓库根或 `apps/tauri` 下跑
 * （根 `vitest.config` 与包内各有一份），cwd 相对路径在其中一次会指错。
 */
async function readRegionListSource(): Promise<string> {
  const { readFileSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = dirname(fileURLToPath(import.meta.url))  // …/regions/__tests__
  return readFileSync(join(here, '..', 'RegionList.vue'), 'utf8')
}

/** 去掉注释再扫描：注释里提到 store 名不算违规（否则改注释就会被误判）。 */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('regions 视图取数经服务（阶段 3 试点）', () => {
  it('不再直连 useEntityStore / useRelationStore', async () => {
    const code = stripComments(await readRegionListSource())
    expect(code).not.toContain('useEntityStore')
    expect(code).not.toContain('useRelationStore')
    // 连 store 变量名也不该出现（防止有人绕过 import 用注入进来的实例）
    expect(code).not.toMatch(/\bentityStore\b/)
    expect(code).not.toMatch(/\brelationStore\b/)
  })

  it('经 getWorldService 取服务，且用了世界树的两个数据服务', async () => {
    const code = stripComments(await readRegionListSource())
    expect(code).toContain('getWorldService')
    expect(code).toContain("'world.entities'")
    expect(code).toContain("'world.relations'")
  })

  it('服务缺席时抛错而非静默降级（服务是本组件的唯一取数通道）', async () => {
    const code = stripComments(await readRegionListSource())
    // 两处守卫各有一条 throw，且错误信息点名服务名——静默 return [] / undefined 会让
    // 「时序被破坏」表现成「列表莫名其妙是空的」，排查成本极高。
    expect(code).toMatch(/if \(!svc\) throw new Error\([^)]*world\.entities/)
    expect(code).toMatch(/if \(!svc\) throw new Error\([^)]*world\.relations/)
  })

  it('重载走服务的 reload()，不再用 store 的 loadAll()', async () => {
    const code = stripComments(await readRegionListSource())
    expect(code).toContain('.reload()')
    expect(code).not.toContain('loadAll')
  })
})
