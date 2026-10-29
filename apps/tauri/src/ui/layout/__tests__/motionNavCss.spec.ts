import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('侧栏与视图切换 CSS 契约', () => {
  it('侧栏宽度与内容淡出', () => {
    const src = read('apps/tauri/src/ui/layout/sidebar/SidebarV2.vue')
    expect(src).toContain('transition: width 180ms var(--ease-out)')
    expect(src).toContain('transition: opacity 120ms var(--ease)')
    expect(src).toContain('visibility: hidden')
    expect(src).not.toContain('.sidebar.collapsed .sidebar-inner {\n  display: none;')
  })

  it('主区 margin 过渡与降级', () => {
    const src = read('packages/ui-kit/src/components/layout/ViewContainer.vue')
    expect(src).toContain('margin-left 180ms var(--ease-out)')
    expect(src).toContain("data-anim-panels='off'")
    expect(src).toContain("data-reduce-motion='on'")
  })

  it('侧栏降级', () => {
    const src = read('apps/tauri/src/ui/layout/sidebar/SidebarV2.vue')
    expect(src).toContain("data-anim-panels='off'")
    expect(src).toContain("data-reduce-motion='on'")
  })
})
