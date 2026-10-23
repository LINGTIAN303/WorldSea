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
