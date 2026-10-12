import { describe, it, expect } from 'vitest'
import { mapScrollTop, HEADING_SELECTOR } from '../composables/splitScrollSync'

/**
 * 分栏滚动同步纯函数（批 4 V8/I10）。
 * 约定：from 侧 内容 2000 / 视口 600 → max 1400；to 侧 内容 1000 / 视口 600 → max 400。
 */
describe('mapScrollTop 标题锚点映射', () => {
  it('无锚点 → 纯比例', () => {
    expect(mapScrollTop([], [], 1400, 400, 0)).toBe(0)
    expect(mapScrollTop([], [], 1400, 400, 700)).toBe(200)
    expect(mapScrollTop([], [], 1400, 400, 1400)).toBe(400)
  })

  it('from 侧不可滚 → 恒 0（无论锚点）', () => {
    expect(mapScrollTop([], [], 0, 400, 0)).toBe(0)
    expect(mapScrollTop([100, 200], [50, 100], 0, 400, 0)).toBe(0)
  })

  it('单锚点：首段 / 中段 / 尾段 三段插值', () => {
    // from anchors [600] max 1400；to anchors [200] max 400
    expect(mapScrollTop([600], [200], 1400, 400, 0)).toBe(0)
    expect(mapScrollTop([600], [200], 1400, 400, 600)).toBe(200) // 命中锚点
    expect(mapScrollTop([600], [200], 1400, 400, 1000)).toBe(300) // 锚点后中点
    expect(mapScrollTop([600], [200], 1400, 400, 1400)).toBe(400)
  })

  it('多锚点：区间定位逐段命中', () => {
    // from [300, 800, 1200] max 1400；to [100, 250, 380] max 400
    expect(mapScrollTop([300, 800, 1200], [100, 250, 380], 1400, 400, 0)).toBe(0)
    expect(mapScrollTop([300, 800, 1200], [100, 250, 380], 1400, 400, 300)).toBe(100) // 第 1 锚点
    expect(mapScrollTop([300, 800, 1200], [100, 250, 380], 1400, 400, 550)).toBe(175) // 1..2 中点
    expect(mapScrollTop([300, 800, 1200], [100, 250, 380], 1400, 400, 800)).toBe(250) // 第 2 锚点
    expect(mapScrollTop([300, 800, 1200], [100, 250, 380], 1400, 400, 1000)).toBe(315) // 2..3 中点
    expect(mapScrollTop([300, 800, 1200], [100, 250, 380], 1400, 400, 1200)).toBe(380) // 第 3 锚点
    expect(mapScrollTop([300, 800, 1200], [100, 250, 380], 1400, 400, 1300)).toBe(390) // 尾段中点
    expect(mapScrollTop([300, 800, 1200], [100, 250, 380], 1400, 400, 1400)).toBe(400)
  })

  it('锚点越界 → clamp 进滚动空间（不越出 toMax）', () => {
    // from 1600→clamp 1400、to 500→clamp 400（点列变 [0,1400,1400] / [0,400,400]）
    expect(mapScrollTop([1600], [500], 1400, 400, 1400)).toBe(400)
    expect(mapScrollTop([1600], [500], 1400, 400, 700)).toBe(200) // 首段中点
  })

  it('乱序锚点 → 单调修正（结果合规、不回退）', () => {
    // from [900, 300]（乱序）→ 修正 [900, 900]；to [200, 80] → [200, 200]
    const v = mapScrollTop([900, 300], [200, 80], 1400, 400, 500)
    expect(v).toBeCloseTo(111.111, 2)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(400)
  })

  it('y 越界 → clamp 到边界', () => {
    expect(mapScrollTop([600], [200], 1400, 400, -100)).toBe(0)
    expect(mapScrollTop([600], [200], 1400, 400, 9999)).toBe(400)
  })

  it('两侧锚点数不等 → 取较短的一段段映射', () => {
    // from [300, 800] vs to [100] → n=1：fromPts [0,300,1400]、toPts [0,100,400]
    // y=550 → 段 [300,1400] t=250/1100 → 100 + t*300
    expect(mapScrollTop([300, 800], [100], 1400, 400, 550)).toBeCloseTo(168.1818, 3)
  })

  it('选择器常量稳定（编辑器/预览同口径）', () => {
    expect(HEADING_SELECTOR).toBe('h1,h2,h3,h4,h5,h6')
  })
})
