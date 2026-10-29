import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('EntityCard 高亮设置接线', () => {
  const src = readFileSync(resolve(process.cwd(), 'packages/plugin-sdk/src/components/EntityCard.vue'), 'utf8')

  it('淡化透明度与 150ms 过渡', () => {
    expect(src).toContain("'--hl-dim-opacity': settings.highlight_dimOpacity")
    expect(src).toContain('opacity var(--dur-fast, 0.15s)')
  })

  it('脉冲动画受设置控制并可降级', () => {
    expect(src).toContain("'hl-pulse': active && settings.highlight_pulseEnabled")
    expect(src).toContain("data-reduce-motion='on'")
  })
})
