import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('材质配方', () => {
  it('液态玻璃含噪声与饱和度提升', () => {
    const css = read('packages/style-kit/src/presets/soft-glass.css')
    expect(css).toContain('var(--sf-noise)')
    expect(css).toContain('saturate(1.8)')
    expect(css).toContain('--sf-highlight')
  })

  it('新拟态含表面渐变与强调光晕', () => {
    const css = read('packages/style-kit/src/presets/neu.css')
    expect(css).toContain('linear-gradient(145deg')
    expect(css).toContain('var(--sf-noise)')
    expect(css).toContain('--sf-ambient')
  })

  it('灯箱使用 clear 变体与 35% 暗化', () => {
    const vue = read('packages/plugin-sdk/src/components/ImageLightbox.vue')
    expect(vue).toContain('backdrop-filter')
    expect(vue).toContain('35%')
  })
})
