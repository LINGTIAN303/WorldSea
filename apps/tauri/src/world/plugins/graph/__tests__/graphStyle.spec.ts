/**
 * 图谱视觉策略纯函数（2026-10-09 图谱改进批 A；批 B 增搜索匹配与 tooltip 定位）。
 *
 * 病：边曾一律 `rgba(255,255,255,0.12)` 1px、方向语义丢失（数据层 noArrow/bidirectional 早就位）。
 * 断言锚点：方向程序三分支与优先级、类型色带透明度、高亮档、标签阈值三档边界、
 * 搜索匹配（空串/大小写/子串）、tooltip 视口翻转与保底。
 * 视觉终审走真机走查（WebGL 画布无自动化手段），此件锁策略层。
 */
import { describe, expect, it } from 'vitest'
import {
  EDGE_BASE_SIZE,
  EDGE_HIGHLIGHT_SIZE,
  edgeBaseVisual,
  edgeHighlightVisual,
  edgeProgramFor,
  labelThresholdFor,
  matchNodeIds,
  tooltipPosition,
  withAlpha,
} from '../graphStyle'

describe('edgeProgramFor / 方向程序', () => {
  it('有向关系 → 单箭头', () => {
    expect(edgeProgramFor({})).toBe('arrow')
  })

  it('双向或对称 → 双箭头', () => {
    expect(edgeProgramFor({ bidirectional: true })).toBe('double-arrow')
    expect(edgeProgramFor({ symmetric: true })).toBe('double-arrow')
  })

  it('noArrow 优先：声明无向时双向语义也服从无箭头', () => {
    expect(edgeProgramFor({ noArrow: true })).toBe('line')
    expect(edgeProgramFor({ noArrow: true, bidirectional: true })).toBe('line')
  })
})

describe('withAlpha', () => {
  it('6 位 hex → rgba', () => {
    expect(withAlpha('#7c4dff', 0.5)).toBe('rgba(124,77,255,0.5)')
    expect(withAlpha('#000000', 0.55)).toBe('rgba(0,0,0,0.55)')
  })

  it('非 6 位 hex 原样透传（防御：注册表兜底色均 hex）', () => {
    expect(withAlpha('rgba(1,2,3,0.5)', 0.5)).toBe('rgba(1,2,3,0.5)')
    expect(withAlpha('', 0.5)).toBe('')
  })
})

describe('edgeBaseVisual / edgeHighlightVisual', () => {
  it('默认档：程序 + 类型色带透明度 + 基础线宽', () => {
    const v = edgeBaseVisual({ color: '#ff5252', bidirectional: true })
    expect(v).toEqual({ type: 'double-arrow', color: 'rgba(255,82,82,0.55)', size: EDGE_BASE_SIZE })
  })

  it('无向类型默认档为直线', () => {
    expect(edgeBaseVisual({ color: '#78909c', noArrow: true }).type).toBe('line')
  })

  it('高亮档更亮更粗，程序不变', () => {
    const v = edgeHighlightVisual({ color: '#ff5252', noArrow: true })
    expect(v).toEqual({ type: 'line', color: 'rgba(255,82,82,0.95)', size: EDGE_HIGHLIGHT_SIZE })
  })
})

describe('labelThresholdFor / 缩放两档', () => {
  it('三档边界：远看只大节点、放大后全标', () => {
    expect(labelThresholdFor(2)).toBe(9)
    expect(labelThresholdFor(1.2)).toBe(9)
    expect(labelThresholdFor(1.19)).toBe(7)
    expect(labelThresholdFor(0.6)).toBe(7)
    expect(labelThresholdFor(0.59)).toBe(4)
    expect(labelThresholdFor(0.2)).toBe(4)
  })
})

describe('matchNodeIds / 搜索匹配（批 B）', () => {
  const nodes = [
    { id: 'a', name: '庆晨' },
    { id: 'b', name: '庆国' },
    { id: 'c', name: 'Alice' },
  ]

  it('子串匹配且大小写不敏感', () => {
    expect(matchNodeIds(nodes, '庆')).toEqual(['a', 'b'])
    expect(matchNodeIds(nodes, 'alice')).toEqual(['c'])
    expect(matchNodeIds(nodes, 'ALICE')).toEqual(['c'])
  })

  it('空串/纯空白 → 空集（调用方据此恢复全图）', () => {
    expect(matchNodeIds(nodes, '')).toEqual([])
    expect(matchNodeIds(nodes, '   ')).toEqual([])
  })

  it('无命中 → 空集', () => {
    expect(matchNodeIds(nodes, '不存在')).toEqual([])
  })
})

describe('tooltipPosition / 跟随定位（批 B）', () => {
  it('常规位：指针右下 14px', () => {
    expect(tooltipPosition(100, 100, 1000, 800)).toEqual({ x: 114, y: 114 })
  })

  it('近右缘：翻到指针左侧', () => {
    expect(tooltipPosition(950, 100, 1000, 800)).toEqual({ x: 950 - 240 - 14, y: 114 })
  })

  it('近下缘：翻到指针上方', () => {
    expect(tooltipPosition(100, 780, 1000, 800)).toEqual({ x: 114, y: 780 - 56 - 14 })
  })

  it('左上保底 8px（翻转后越界不回负）', () => {
    expect(tooltipPosition(5, 5, 50, 50)).toEqual({ x: 8, y: 8 })
  })
})
