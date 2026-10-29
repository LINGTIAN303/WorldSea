import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('首页最近动态列表动效', () => {
  it('使用 ws-list 的 TransitionGroup', () => {
    const src = readFileSync(resolve(process.cwd(), 'apps/tauri/src/ui/home/HomeSurface.vue'), 'utf8')
    expect(src).toContain('<TransitionGroup v-if="data.recent.length" name="ws-list" tag="ul"')
  })
})
