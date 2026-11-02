/**
 * 视图容器定位守卫：
 * `contain: layout` 会成为 fixed 后代的包含块，使详情抽屉/遮罩从容器（工具条下方）开始，
 * 表现为「面板没盖住工具条」。这里锁住只用 style containment。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'packages/ui-kit/src/components/layout/ViewContainer.vue'),
  'utf8',
)

describe('ViewContainer 定位', () => {
  it('不对 fixed 浮层使用 layout containment', () => {
    expect(source).not.toMatch(/contain:\s*(layout|strict|paint|content)/)
    expect(source).toMatch(/contain:\s*style;/)
  })
})

/**
 * 背景拆分守卫：视图层放进 .view-content 外框、滚动下沉到 .view-scroll。
 * .view-content 一旦加 z-index 或改回滚动容器，背景层会随内容滚走/钳制 fixed 浮层。
 */
describe('ViewContainer 背景拆分', () => {
  it('视图层挂在外框、滚动下沉到内层', () => {
    expect(source).toMatch(/<BackgroundLayer target="content-view" \/>/)
    expect(source).toMatch(/class="view-scroll"/)
    // 层必须在 .view-content 内、.view-scroll 之前：壁纸不进入滚动内容
    const contentAt = source.indexOf('class="view-content"')
    const layerAt = source.indexOf('<BackgroundLayer target="content-view" />')
    const scrollAt = source.indexOf('class="view-scroll"')
    expect(contentAt).toBeGreaterThan(-1)
    expect(layerAt).toBeGreaterThan(contentAt)
    expect(layerAt).toBeLessThan(scrollAt)
    const rule = source.match(/\.view-content\s*\{[^}]*\}/s)?.[0] ?? ''
    expect(rule).not.toMatch(/z-index/)
    expect(rule).toMatch(/overflow:\s*hidden/)
    const scrollRule = source.match(/\.view-scroll\s*\{[^}]*\}/s)?.[0] ?? ''
    expect(scrollRule).toMatch(/height:\s*100%/)
    expect(scrollRule).toMatch(/overflow:\s*auto/)
    expect(scrollRule).not.toMatch(/z-index/)
  })

  it('工具条层只在 bar 形态挂载', () => {
    const toolbar = readFileSync(
      join(process.cwd(), 'packages/ui-kit/src/components/layout/ViewToolbar.vue'),
      'utf8',
    )
    expect(toolbar).toMatch(/v-if="toolbarMode === 'bar'"/)
    expect(toolbar).toMatch(/BackgroundLayer target="content-toolbar"/)
  })
})
