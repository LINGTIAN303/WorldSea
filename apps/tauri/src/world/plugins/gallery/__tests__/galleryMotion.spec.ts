import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('画廊筛选淡入', () => {
  const src = readFileSync(resolve(process.cwd(), 'apps/tauri/src/world/plugins/gallery/GalleryView.vue'), 'utf8')

  it('使用 useViewEntering 驱动网格入场', () => {
    expect(src).toContain('useViewEntering')
    expect(src).toContain("'is-grid-entering': gridEntering")
  })

  it('内容动效关闭与减弱动效时停用', () => {
    expect(src).toContain("data-anim-content='off'")
    expect(src).toContain("data-reduce-motion='on'")
  })
})
