import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('DetailShell 滚动契约', () => {
  const src = readFileSync(resolve(process.cwd(), 'packages/plugin-sdk/src/components/DetailShell.vue'), 'utf8')

  it('不用 scrollIntoView，避免抽屉入场时整页横向滚动', () => {
    expect(src).not.toContain('.scrollIntoView(')
    expect(src).toContain('scrollActiveTabIntoView')
    expect(src).toContain('focus({ preventScroll: true })')
  })
})
