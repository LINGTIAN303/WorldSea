/**
 * virtualWindow 单测 —— 表格式虚拟滚动的窗口计算（2026-10-25）
 */
import { describe, it, expect } from 'vitest'
import { computeVirtualWindow } from '../virtualWindow'

describe('virtualWindow / computeVirtualWindow', () => {
  it('空表返回空窗口', () => {
    expect(computeVirtualWindow(0, 0, 300, 30)).toEqual({ start: 0, end: 0 })
  })

  it('顶部：从 0 开始，含视口行数与 overscan', () => {
    // 视口 300 / 行高 30 = 10 行；overscan 2 → end 12
    expect(computeVirtualWindow(100, 0, 300, 30, 2)).toEqual({ start: 0, end: 12 })
  })

  it('中部：按 scrollTop 推算首行并上下各留 overscan', () => {
    // scrollTop 600 / 30 = 第 20 行；overscan 2 → start 18，end 20+10+2=32
    expect(computeVirtualWindow(100, 600, 300, 30, 2)).toEqual({ start: 18, end: 32 })
  })

  it('底部：end 钳到总行数，start 不越界', () => {
    expect(computeVirtualWindow(100, 3000, 300, 30, 2)).toEqual({ start: 98, end: 100 })
  })

  it('overscan=0：只渲染视口行', () => {
    expect(computeVirtualWindow(100, 600, 300, 30, 0)).toEqual({ start: 20, end: 30 })
  })

  it('非有限值回退到安全默认（不产生 NaN）', () => {
    expect(computeVirtualWindow(Number.NaN, 0, 300, 30)).toEqual({ start: 0, end: 0 })
    const w = computeVirtualWindow(10, Number.NaN, Number.NaN, Number.NaN, Number.NaN)
    expect(Number.isFinite(w.start)).toBe(true)
    expect(Number.isFinite(w.end)).toBe(true)
    expect(w.start).toBeLessThanOrEqual(w.end)
  })

  it('行高为 0 / 负数时按 1 处理（防御除零）', () => {
    expect(computeVirtualWindow(10, 5, 30, 0, 0)).toEqual({ start: 5, end: 10 })
  })
})
