/**
 * contextMenu 单测 —— 白板右键菜单的落点解析、菜单构建、定位钳位与键盘导航（全纯函数）。
 *
 * 这层的价值在于「菜单内容是数据」：新增动作只改 `buildMenuItems` 一处，
 * 且四条分流规则（最内层优先 / 悬空容器只留清理 / 危险动作殿后 / 禁用而非隐藏）
 * 都能在这里被钉住。
 */
import { describe, it, expect } from 'vitest'
import {
  buildMenuItems,
  clampMenuPosition,
  containerIdOfTarget,
  CTX_ATTR,
  DEFAULT_CONTEXT_STATE,
  nextEnabledIndex,
  resolveContextTarget,
  type ContextState,
  type MenuItem,
} from '../board/contextMenu'

/** 桩：链上每一层可带/不带 data-ctx（不带 = 普通元素，closest 会跳过它） */
interface Step {
  ctx?: string
  id?: string
}

/**
 * 造一条「从最内层到最外层」的元素链，只需 closest / getAttribute 两个能力。
 * `closest` 从**自身**开始向上匹配（与真实 DOM 一致），故「组件行有标注但祖先没有容器」
 * 这类边界用 `makeEl([{ ctx: 'component', id: 'c1' }])` 就能自然表达。
 */
function makeEl(chain: Step[]): Element {
  const nodes = chain.map((step: Step) => ({
    getAttribute(name: string): string | null {
      if (name === CTX_ATTR) return step.ctx ?? null
      if (name === 'data-ctx-id') return step.id ?? null
      return null
    },
    closest(sel: string): unknown {
      const m = /^\[data-ctx(?:="([^"]+)")?\]$/.exec(sel)
      if (!m) return null
      const want = m[1]
      for (let i = nodes.indexOf(this); i < chain.length; i += 1) {
        const s = chain[i]
        if (!s.ctx) continue
        if (!want || s.ctx === want) return nodes[i]
      }
      return null
    },
  }))
  return nodes[0] as unknown as Element
}

const state = (patch: Partial<ContextState> = {}): ContextState => ({
  ...DEFAULT_CONTEXT_STATE,
  ...patch,
})

describe('contextMenu / 落点解析', () => {
  it('组件行：最内层优先，容器 id 从祖先读', () => {
    const target = resolveContextTarget(makeEl([
      { ctx: 'component', id: 'c1' },
      { ctx: 'container', id: 'box1' },
      { ctx: 'section', id: 's1' },
    ]))
    expect(target).toEqual({ kind: 'component', containerId: 'box1', componentId: 'c1' })
  })

  it('容器（不在组件行内）', () => {
    expect(resolveContextTarget(makeEl([{ ctx: 'container', id: 'box1' }])))
      .toEqual({ kind: 'container', id: 'box1' })
  })

  it('区', () => {
    expect(resolveContextTarget(makeEl([{ ctx: 'section', id: 's1' }])))
      .toEqual({ kind: 'section', id: 's1' })
  })

  it('容器内的区（容器在区之上）：仍取最内层的容器', () => {
    expect(resolveContextTarget(makeEl([
      { ctx: 'container', id: 'box1' },
      { ctx: 'section', id: 's1' },
    ]))).toEqual({ kind: 'container', id: 'box1' })
  })

  it('无标注 / 空元素 → 画布空白（画布本身无需任何标注）', () => {
    expect(resolveContextTarget(null)).toEqual({ kind: 'canvas' })
    expect(resolveContextTarget(makeEl([{ id: 'plain' }]))).toEqual({ kind: 'canvas' })
  })

  it('标注缺 id（脏数据）→ 退化为画布空白，而不是产生无法定位的菜单', () => {
    expect(resolveContextTarget(makeEl([{ ctx: 'container' }]))).toEqual({ kind: 'canvas' })
    expect(resolveContextTarget(makeEl([{ ctx: 'section' }]))).toEqual({ kind: 'canvas' })
  })

  it('组件行的祖先里没有容器 → 退化为画布空白', () => {
    expect(resolveContextTarget(makeEl([{ ctx: 'component', id: 'c1' }]))).toEqual({ kind: 'canvas' })
  })
})

describe('contextMenu / containerIdOfTarget', () => {
  it('容器与组件行都能取到容器 id；画布与区为 null', () => {
    expect(containerIdOfTarget({ kind: 'container', id: 'box1' })).toBe('box1')
    expect(containerIdOfTarget({ kind: 'component', containerId: 'box1', componentId: 'c1' })).toBe('box1')
    expect(containerIdOfTarget({ kind: 'canvas' })).toBeNull()
    expect(containerIdOfTarget({ kind: 'section', id: 's1' })).toBeNull()
  })
})

describe('contextMenu / 画布空白菜单', () => {
  it('含「新建节点并放置」（双击的可发现性出口，09-17 拍板保留）', () => {
    const ids = buildMenuItems({ kind: 'canvas' }, state()).map(i => i.id)
    expect(ids).toContain('new-node')
  })

  it('视图类动作齐备，且适配全部带快捷键提示', () => {
    const items = buildMenuItems({ kind: 'canvas' }, state())
    const ids = items.map(i => i.id)
    expect(ids).toEqual([
      'new-node', 'fit-all', 'zoom-100', 'toggle-grid', 'snap-off', 'snap-grid', 'snap-guides',
    ])
    expect(items.find(i => i.id === 'fit-all')?.keys).toBe('Shift+1')
  })

  it('网格与吸附三态用 checked 表达当前值（吸附是 radio 语义）', () => {
    const items = buildMenuItems({ kind: 'canvas' }, state({ gridEnabled: true, snapMode: 'grid' }))
    expect(items.find(i => i.id === 'toggle-grid')?.checked).toBe(true)
    expect(items.find(i => i.id === 'snap-grid')?.checked).toBe(true)
    expect(items.find(i => i.id === 'snap-off')?.checked).toBe(false)
    expect(items.find(i => i.id === 'snap-guides')?.checked).toBe(false)
  })

  it('不放白板级动作（改名/导出/删除白板）——那属列表层与工具条', () => {
    const ids = buildMenuItems({ kind: 'canvas' }, state()).map(i => i.id)
    expect(ids.some(id => /board|export/.test(id))).toBe(false)
  })
})

describe('contextMenu / 区菜单', () => {
  it('四项，删除区标红且殿后', () => {
    const items = buildMenuItems({ kind: 'section', id: 's1' }, state())
    expect(items.map(i => i.id)).toEqual([
      'rename-section', 'rearrange-section', 'fit-section', 'remove-section',
    ])
    expect(items[3].danger).toBe(true)
    expect(items.filter(i => i.danger)).toHaveLength(1)
  })
})

describe('contextMenu / 容器菜单', () => {
  it('完整七项，危险动作殿后', () => {
    const items = buildMenuItems({ kind: 'container', id: 'box1' }, state({ hasManuscript: true }))
    expect(items.map(i => i.id)).toEqual([
      'open-manuscript', 'reveal-in-sidebar', 'add-form',
      'toggle-collapse', 'reset-size', 'remove-container',
    ])
    expect(items[items.length - 1].danger).toBe(true)
  })

  it('没有关联章节 → 「打开正文」禁用（而非隐藏，保持菜单结构稳定）', () => {
    const items = buildMenuItems({ kind: 'container', id: 'box1' }, state({ hasManuscript: false }))
    expect(items.find(i => i.id === 'open-manuscript')?.disabled).toBe(true)
  })

  it('已是内容自适应 → 「恢复内容自适应」禁用（避免点了没反应）', () => {
    const items = buildMenuItems({ kind: 'container', id: 'box1' }, state({ autoSized: true }))
    expect(items.find(i => i.id === 'reset-size')?.disabled).toBe(true)
    const fixed = buildMenuItems({ kind: 'container', id: 'box1' }, state({ autoSized: false }))
    expect(fixed.find(i => i.id === 'reset-size')?.disabled).toBe(false)
  })

  it('折叠态下该项标签变「展开」（同一动作，标签随状态）', () => {
    const collapsed = buildMenuItems({ kind: 'container', id: 'box1' }, state({ collapsed: true }))
    expect(collapsed.find(i => i.id === 'toggle-collapse')?.label).toBe('展开')
    const expanded = buildMenuItems({ kind: 'container', id: 'box1' }, state({ collapsed: false }))
    expect(expanded.find(i => i.id === 'toggle-collapse')?.label).toBe('折叠')
  })

  it('悬空容器（节点已删）**只留**清理项——其余项对无节点的容器毫无意义', () => {
    const items = buildMenuItems({ kind: 'container', id: 'box1' }, state({ dangling: true }))
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('remove-container')
    expect(items[0].label).toContain('节点已删除')
    expect(items[0].danger).toBe(true)
  })
})

describe('contextMenu / 组件行菜单', () => {
  it('四项，移除标红殿后', () => {
    const items = buildMenuItems({ kind: 'component', containerId: 'box1', componentId: 'c1' }, state())
    expect(items.map(i => i.id)).toEqual([
      'focus-inspector', 'move-component-up', 'move-component-down', 'remove-component',
    ])
    expect(items[3].danger).toBe(true)
  })

  it('首个组件不能上移、末个不能下移（禁用而非隐藏，位置稳定可预期）', () => {
    const first = buildMenuItems(
      { kind: 'component', containerId: 'box1', componentId: 'c1' },
      state({ isFirstComponent: true, isLastComponent: false }),
    )
    expect(first.find(i => i.id === 'move-component-up')?.disabled).toBe(true)
    expect(first.find(i => i.id === 'move-component-down')?.disabled).toBe(false)

    const last = buildMenuItems(
      { kind: 'component', containerId: 'box1', componentId: 'c1' },
      state({ isFirstComponent: false, isLastComponent: true }),
    )
    expect(last.find(i => i.id === 'move-component-up')?.disabled).toBe(false)
    expect(last.find(i => i.id === 'move-component-down')?.disabled).toBe(true)
  })

  it('只有一项时上下移都禁用', () => {
    const only = buildMenuItems(
      { kind: 'component', containerId: 'box1', componentId: 'c1' },
      state({ isFirstComponent: true, isLastComponent: true }),
    )
    expect(only.find(i => i.id === 'move-component-up')?.disabled).toBe(true)
    expect(only.find(i => i.id === 'move-component-down')?.disabled).toBe(true)
  })
})

describe('contextMenu / clampMenuPosition', () => {
  const menu = { w: 180, h: 200 }
  const vp = { w: 1000, h: 800 }

  it('正常位置原样返回', () => {
    expect(clampMenuPosition(100, 100, menu, vp)).toEqual({ x: 100, y: 100 })
  })

  it('右下越界 → 向左上翻，保证菜单完整可见（右键点在屏幕边缘时）', () => {
    const p = clampMenuPosition(980, 780, menu, vp)
    expect(p.x).toBe(1000 - 180 - 4)
    expect(p.y).toBe(800 - 200 - 4)
  })

  it('左上越界（负值）→ 钳到边距', () => {
    expect(clampMenuPosition(-50, -20, menu, vp)).toEqual({ x: 4, y: 4 })
  })

  it('视口比菜单还小 → 不产生负坐标（退化时贴左上）', () => {
    const p = clampMenuPosition(10, 10, menu, { w: 100, h: 100 })
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.y).toBeGreaterThanOrEqual(0)
  })
})

describe('contextMenu / nextEnabledIndex（键盘导航）', () => {
  const items: MenuItem[] = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B', disabled: true },
    { id: 'c', label: 'C' },
  ]

  it('向下跳过禁用项', () => {
    expect(nextEnabledIndex(items, 0, 1)).toBe(2)
  })

  it('向上跳过禁用项', () => {
    expect(nextEnabledIndex(items, 2, -1)).toBe(0)
  })

  it('从 -1 开始：向下取首项、向上取末项（未高亮时的首次按键）', () => {
    expect(nextEnabledIndex(items, -1, 1)).toBe(0)
    expect(nextEnabledIndex(items, -1, -1)).toBe(2)
  })

  it('循环回绕', () => {
    expect(nextEnabledIndex(items, 2, 1)).toBe(0)
    expect(nextEnabledIndex(items, 0, -1)).toBe(2)
  })

  it('全部禁用 → -1（调用方据此不做任何事）', () => {
    expect(nextEnabledIndex([{ id: 'x', label: 'X', disabled: true }], -1, 1)).toBe(-1)
  })

  it('空菜单 → -1，不抛错', () => {
    expect(nextEnabledIndex([], -1, 1)).toBe(-1)
  })
})
