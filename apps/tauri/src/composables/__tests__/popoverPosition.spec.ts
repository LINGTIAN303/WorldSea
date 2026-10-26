/**
 * popoverPosition — 弹层定位纯函数契约（走查修复轮 3，2026-10-12；批3 随共享化迁入）。
 *
 * 锁定策略：
 * - 下方优先；下方「完整放不下但够高（≥150px）」→ **缩高放下方**（不翻走，位置贴锚点）；
 * - 下方过矮（<150px）→ 翻上（完整放下 / 部分可用缩高）；
 * - 两侧都过矮（极端窗口）→ 取宽裕侧贴边；差值接近时保持 preferDir（防抖）；
 * - 锚点缺失 → null（调用方保持原位）；水平/垂直越界内缩。
 *
 * 几何约定：光标行高 20 → rect.bottom = rect.top + 20；
 * 两侧空间之和 = vh - 20（此消彼长，极端用例需用矮视口构造）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computePopoverPos } from '../popoverPosition'

/** 光标行矩形（left, top；宽 80 高 20） */
function caret(left: number, top: number): () => DOMRect {
  return () => new DOMRect(left, top, 80, 20)
}

const SIZE = { width: 300, height: 300 }

describe('popoverPosition · 弹层定位契约（走查修复轮 3）', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 900)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('下方完整放下 → below（原高，不缩）', () => {
    // sb = 900-120 = 780 ≥ 304
    const pos = computePopoverPos(caret(400, 100), SIZE)
    expect(pos).toEqual({ x: 400, y: 124, dir: 'below', maxHeight: null })
  })

  it('下方差一点放不下（sb=300 < 304）→ 缩高放下方，不翻走（核心回归）', () => {
    // 旧版此处满足「sb < size.height+GAP && sa > sb」→ 会翻到上方（中部偏下高频误翻）
    // 缩高值 = sb - GAP - MARGIN = 288；底边 = 604 + 288 = 892 = vh - 8（不贴边）
    const pos = computePopoverPos(caret(400, 580), SIZE)
    expect(pos).toEqual({ x: 400, y: 604, dir: 'below', maxHeight: 288 })
  })

  it('下方过矮（sb=100 < 150）且上方完整放得下 → 翻上，原高', () => {
    const pos = computePopoverPos(caret(400, 780), SIZE)
    // above：y = 780 - 304 = 476
    expect(pos).toEqual({ x: 400, y: 476, dir: 'above', maxHeight: null })
  })

  it('下方过矮、上方部分可用 → 翻上 + 缩高（矮视口构造）', () => {
    vi.stubGlobal('innerHeight', 400)
    // top=250 → sa=250 ∈[150,304)；sb=400-270=130 <150 → above + maxHeight=238
    const pos = computePopoverPos(caret(400, 250), SIZE)
    expect(pos).toEqual({ x: 400, y: 8, dir: 'above', maxHeight: 238 }) // y 负值被内缩兜底到 8
  })

  it('两侧都过矮且胶着（vh=280）→ 保持 preferDir 防抖', () => {
    vi.stubGlobal('innerHeight', 280)
    // top=130 → sa=130、sb=280-150=130（差 0 ≤ 24 → 防抖保持 below）
    const below = computePopoverPos(caret(400, 130), SIZE, 'below')
    expect(below).toEqual({ x: 400, y: 154, dir: 'below', maxHeight: 118 })
    const above = computePopoverPos(caret(400, 130), SIZE, 'above')
    expect(above?.dir).toBe('above')
  })

  it('两侧都过矮且不胶着（差 > 24）→ 取宽裕侧', () => {
    vi.stubGlobal('innerHeight', 280)
    // top=145 → sa=145、sb=280-165=115（差 -30 → above 宽裕）
    const pos = computePopoverPos(caret(400, 145), SIZE)
    expect(pos).toEqual({ x: 400, y: 8, dir: 'above', maxHeight: 133 })
  })

  it('锚点缺失 → null（调用方保持原位；不乱跳兜底位置）', () => {
    expect(computePopoverPos(null, SIZE)).toBeNull()
    expect(computePopoverPos(() => null, SIZE)).toBeNull()
  })

  it('水平右溢 → 内缩到视口内', () => {
    const pos = computePopoverPos(caret(950, 100), SIZE)
    expect(pos?.x).toBe(692) // 1000-300-8
  })
})
