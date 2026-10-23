import { describe, expect, it } from 'vitest'
import {
  ACCENT_PRESETS,
} from '../useTheme'
import { contrastRatio, deriveDark, deriveGradTo, hexToOklch, oklchToHex, pickOnAccent, quantizeAnchor } from '../accentColor'

/** 通道级近似比较（往返/基准复现允许 ±2/255 的舍入差） */
function expectCloseHex(actual: string, expected: string, tol = 2): void {
  const ch = (h: string) => [0, 2, 4].map(i => parseInt(h.replace('#', '').slice(i, i + 2), 16))
  const [a, e] = [ch(actual), ch(expected)]
  expect(Math.abs(a[0] - e[0])).toBeLessThanOrEqual(tol)
  expect(Math.abs(a[1] - e[1])).toBeLessThanOrEqual(tol)
  expect(Math.abs(a[2] - e[2])).toBeLessThanOrEqual(tol)
}

describe('accentColor OKLCH 派生算法', () => {
  it('锚点色 hex→OKLCH→hex 往返精确（±2/255）', () => {
    for (const p of ACCENT_PRESETS) {
      expectCloseHex(oklchToHex(hexToOklch(p.light)), p.light)
    }
  })

  it('全部浅色锚点过 AA 白字线（≥4.5:1）', () => {
    for (const p of ACCENT_PRESETS) {
      expect(contrastRatio(p.light, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('deriveDark（仅算法派生项）：亮度落在 0.70~0.82 带、饱和 ≤0.15、色相保持（±3°）', () => {
    for (const p of ACCENT_PRESETS) {
      const src = hexToOklch(p.light)
      // 手工深色（靛蓝=theme.css 基准 / 水墨=特殊中性）是设计基准值，不受算法带约束
      if (p.dark) continue
      const dark = hexToOklch(deriveDark(p.light))
      expect(dark.l).toBeGreaterThanOrEqual(0.70)
      expect(dark.l).toBeLessThanOrEqual(0.82)
      expect(dark.c).toBeLessThanOrEqual(0.15)
      const dh = Math.abs(dark.h - src.h)
      expect(Math.min(dh, 360 - dh)).toBeLessThanOrEqual(3)
    }
  })

  it('on-accent 择向：浅色锚点全白字，深色主值全墨字', () => {
    for (const p of ACCENT_PRESETS) {
      expect(pickOnAccent(p.light)).toBe('#ffffff')
      expect(pickOnAccent(p.dark ?? deriveDark(p.light))).toBe('#17171b')
    }
  })

  it('靛蓝渐变末端复现 theme.css 基准 #7c3aed（±2/255）', () => {
    expectCloseHex(deriveGradTo('#4f46e5'), '#7c3aed')
  })

  it('quantizeAnchor：任意自定义输入合规化后过 AA 白字线且色相保持', () => {
    // 极端输入：高明度黄 / 纯白 / 纯黑 / 高饱和红 / 预设级中饱和
    for (const input of ['#fef08a', '#ffffff', '#000000', '#ff0000', '#22d3ee', '#4f46e5']) {
      const out = quantizeAnchor(input)
      expect(contrastRatio(out, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      const [src, dst] = [hexToOklch(input), hexToOklch(out)]
      // 合规化只动亮度/饱和，色相保持（白色无色相除外）
      if (src.c > 0.04) {
        const dh = Math.abs(dst.h - src.h)
        expect(Math.min(dh, 360 - dh)).toBeLessThanOrEqual(3)
      }
      expect(dst.l).toBeGreaterThanOrEqual(0.30)
      // 色域回收会使亮度略漂移，上界放宽；AA 线是硬保证（循环按转换后实测回退）
      expect(dst.l).toBeLessThanOrEqual(0.60)
    }
    // 已合规的输入应原样通过（量化幂等）
    expect(quantizeAnchor('#4f46e5')).toBe('#4f46e5')
  })
})
