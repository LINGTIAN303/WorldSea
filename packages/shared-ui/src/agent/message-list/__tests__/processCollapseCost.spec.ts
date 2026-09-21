/**
 * 过程层折叠控制器的复杂度契约（2026-09-20 帧率修复）
 *
 * 背景：控制器在每个 delta（turns 引用变化）后重评估所有轮次。视口探测在生产侧是
 * 「全 DOM 子树遍历 + 强制布局」，若为每一轮都提前求值，长会话下每个 delta 就是
 * O(轮次数 × 窗口 DOM 节点数) 次节点访问 —— 主线程被占满、rAF 被饿死，
 * 表现为流式（尤其推理过程）打字机掉帧。
 *
 * 契约（本文件锁定）：
 * - 稳态（所有轮次都判 'skip'）→ 每 delta 对消息 DOM 的 `[data-turn-id]` 查询次数为 **0**（惰性）
 * - 有轮次真的需要可见性 → 每 delta 至多 **1** 次查询，且**不随轮次数增长**
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { defineComponent, nextTick, ref, type Ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { Turn } from '@worldsea/shared-composables/agent/turnModel'
import { useProcessCollapse } from '../useProcessCollapse'

/** 最小轮次构造：默认是「已自动折叠」的完成轮 → 判定恒为 'skip' */
function turn(id: string, over: Partial<Turn> = {}): Turn {
  return {
    id,
    userMessage: { id: `user-${id}`, text: '问题', timestamp: 1 },
    segments: [],
    resultId: `res-${id}`,
    candidateId: null,
    status: 'complete',
    processCollapsed: true,
    userEverExpanded: false,
    hasAutoCollapsed: true,
    startedAt: 1,
    ...over,
  }
}

/** 流式轮：判定 'skip'（结果层未落地） */
function streamingTurn(id: string): Turn {
  return turn(id, { status: 'streaming', resultId: null, processCollapsed: false, hasAutoCollapsed: false })
}

/** 展开过的完成轮：判定需要可见性（唯一会触发视口探测的形态） */
function needsVisibilityTurn(id: string): Turn {
  return turn(id, { processCollapsed: false, hasAutoCollapsed: false, userEverExpanded: true })
}

/** 造 DOM：容器 → .messages-scroll → 每轮一个 [data-turn-id] 过程层元素 */
function buildContainer(turnIds: string[]): HTMLElement {
  const root = document.createElement('div')
  const scroll = document.createElement('div')
  scroll.className = 'messages-scroll'
  for (const id of turnIds) {
    const el = document.createElement('div')
    el.className = 'ws-turn-process'
    el.dataset.turnId = id
    scroll.appendChild(el)
  }
  root.appendChild(scroll)
  document.body.appendChild(root)
  return root
}

/** 挂载控制器：容器与轮次均由外部 ref 驱动 */
function mountController(turns: Ref<Turn[]>, container: Ref<HTMLElement | undefined>, onCollapse: (id: string) => void) {
  return mount(
    defineComponent({
      setup() {
        useProcessCollapse({ turns, container, onCollapse })
        return () => null
      },
    }),
  )
}

/** 统计 `querySelectorAll('[data-turn-id]')` 的调用次数（生产侧该查询即「全 DOM 遍历」成本） */
function spyVisibilityQueries(): { count: () => number; restore: () => void } {
  const original = Element.prototype.querySelectorAll
  let count = 0
  const spy = vi.spyOn(Element.prototype, 'querySelectorAll').mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    if (selector === '[data-turn-id]') count++
    return original.call(this, selector) as NodeListOf<Element>
  })
  return { count: () => count, restore: () => spy.mockRestore() }
}

/** 模拟 N 个 delta：每次替换 turns 数组引用（归约器不可变替换的等价形态） */
async function feedDeltas(turns: Ref<Turn[]>, deltas: number): Promise<void> {
  for (let i = 0; i < deltas; i++) {
    turns.value = [...turns.value]
    await flushPromises()
  }
}

const DELTAS = 5
let mounted: ReturnType<typeof mount> | null = null

afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('useProcessCollapse 复杂度契约', () => {
  it('稳态（全部 skip）：每 delta 对消息 DOM 的查询次数为 0（惰性，不为 skip 轮次白算可见性）', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `t${i}`)
    const turns = ref<Turn[]>([...ids.map((id) => turn(id)), streamingTurn('stream')])
    const container = ref<HTMLElement | undefined>(buildContainer([...ids, 'stream']))
    mounted = mountController(turns, container, () => {})
    await flushPromises()

    const spy = spyVisibilityQueries()
    await feedDeltas(turns, DELTAS)

    expect(spy.count()).toBe(0)
    spy.restore()
  })

  it('需要可见性时：每 delta 至多 1 次查询（每次评估只建一次索引）', async () => {
    const turns = ref<Turn[]>([turn('t0'), turn('t1'), needsVisibilityTurn('t2')])
    const container = ref<HTMLElement | undefined>(buildContainer(['t0', 't1', 't2']))
    const collapsed: string[] = []
    mounted = mountController(turns, container, (id) => collapsed.push(id))
    await flushPromises()
    collapsed.length = 0 // 丢弃挂载时的首次评估（immediate watch），只统计 delta 期间

    const spy = spyVisibilityQueries()
    await feedDeltas(turns, DELTAS)

    // 该轮次展开过且（jsdom 中）不可见 → 判定 'collapse-now'，证明探测确实被需要
    expect(collapsed).toEqual(Array.from({ length: DELTAS }, () => 't2'))
    expect(spy.count()).toBe(DELTAS)
    spy.restore()
  })

  it('查询次数不随轮次数增长（200 轮与 3 轮同为每 delta 1 次）', async () => {
    async function queriesPerDelta(turnCount: number): Promise<number> {
      const skipIds = Array.from({ length: turnCount - 1 }, (_, i) => `s${i}`)
      const ids = [...skipIds, 'target']
      const turns = ref<Turn[]>([...skipIds.map((id) => turn(id)), needsVisibilityTurn('target')])
      const container = ref<HTMLElement | undefined>(buildContainer(ids))
      const wrapper = mountController(turns, container, () => {})
      await flushPromises()

      const spy = spyVisibilityQueries()
      await feedDeltas(turns, DELTAS)
      const total = spy.count()
      spy.restore()
      wrapper.unmount()
      return total / DELTAS
    }

    expect(await queriesPerDelta(3)).toBe(1)
    expect(await queriesPerDelta(200)).toBe(1)
  })

  it('轮次变化仍触发折叠动作（惰性化不得吞掉判定结果）', async () => {
    // 完成轮 + 未展开过 → 条件 1 立即折叠（不依赖视口，且不得触发任何 DOM 查询）
    const turns = ref<Turn[]>([turn('t0', { hasAutoCollapsed: false, processCollapsed: false })])
    const container = ref<HTMLElement | undefined>(buildContainer(['t0']))
    const collapsed: string[] = []
    mounted = mountController(turns, container, (id) => collapsed.push(id))
    await flushPromises()
    collapsed.length = 0 // 丢弃挂载时的首次评估（immediate watch），只统计 delta 期间

    const spy = spyVisibilityQueries()
    turns.value = [...turns.value]
    await flushPromises()

    expect(collapsed).toEqual(['t0'])
    expect(spy.count()).toBe(0)
    spy.restore()
  })
})
