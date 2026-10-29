import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('关联高亮清理', () => {
  const src = readFileSync(resolve(process.cwd(), 'packages/plugin-sdk/src/components/GenericEntityView.vue'), 'utf8')

  it('关闭详情与离开视图时清空高亮', () => {
    expect(src).toContain('if (!entity) listHighlight.select(null)')
    expect(src).toContain('onDeactivated(() => listHighlight.select(null))')
  })
})
