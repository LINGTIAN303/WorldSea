/**
 * C1 对话区性能门禁（本地 gate；三条路径 + 推理流式专项）
 *
 * 运行：`pnpm bench:gate`（= `vitest run -c vitest.bench.config.ts`）
 * 口径（对齐 dsh benchmarks/AGENTS.md）：
 * - 合成输入来自固定常量（fixtures.ts），禁止录制会话 / 网络 / 环境依赖
 * - 预算为源码常量（budgets.ts），环境变量不可覆盖
 * - 时间断言取「多次实测中位数」，并配「判别力自证」——历史记录样本必须在参考期望下被拒绝
 * - 无量纲比值（加速比）不乘时间系数
 * - 每条路径打印基线报告（JSON），供校准 REFERENCE_MS 与人工对照
 *
 * 覆盖边界（诚实标注）：
 * - 已覆盖：归约 / 展平 / 引用缓存判据 / 单轮流式消费 / 推理摘要 / C2 增量 markdown
 * - 未覆盖：浏览器级主线程指标（CDP TaskDuration）与「流式中输入重叠」语义断言 ——
 *   需 Playwright（本仓未引入该依赖），登记为后续项，见 docs/plans 批次 D 施工记录
 */
import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import {
  flattenTurn,
  flattenTurns,
  reduceEvent,
  reduceEvents,
  type FlatRow,
  type Turn,
  type TurnEvent,
} from '../../packages/shared-composables/src/agent/turnModel'
import {
  createMarkdownStreamRenderer,
  hasUnclosedFence,
  renderFullMarkdown,
} from '../../packages/shared-ui/src/agent/bubbles/markdownStream'
import { referenceThinkSummary, thinkSummary } from '../../packages/shared-ui/src/agent/stream/rows/thinkSummary'
import {
  highlightCode,
  referenceHighlightCode,
} from '../../packages/shared-ui/src/agent/bubbles/codeHighlight'
import { ciTimeBudget } from '../support/calibration'
import {
  BUDGET_MS,
  FLATTEN_INCREMENTAL_SPEEDUP_MIN,
  HIGHLIGHT_MEMO_SPEEDUP_MIN,
  MARKDOWN_INCREMENTAL_SPEEDUP_MIN,
  REFERENCE_MS,
  SUMMARY_SPEEDUP_MIN,
} from './budgets'
import {
  buildMarkdownDoc,
  markdownFrames,
  REASONING_DELTAS,
  syntheticCodeSnippet,
  syntheticReasoningText,
  syntheticReasoningTurn,
  syntheticSession,
  syntheticTextDeltas,
  syntheticTurn,
} from './fixtures'

const SAMPLES = 5

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** 取多次实测中位数；测量前先跑一次预热，避免首次 JIT 抖动污染基线 */
function measureMedian(fn: () => void, samples = SAMPLES): number {
  fn()
  const values: number[] = []
  for (let i = 0; i < samples; i++) {
    const start = performance.now()
    fn()
    values.push(performance.now() - start)
  }
  return median(values)
}

function expectWithinBudget(value: number, budget: number): void {
  expect(value).toBeLessThanOrEqual(budget)
}

function report(name: string, payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ benchmark: `conversation/${name}`, ...payload }))
}

// ─── 展平缓存：生产判据等价物（useAgentRust `agentStream` 两级缓存的第一级） ───

interface FlatCacheEntry {
  turn: Turn
  rows: FlatRow[]
}

/**
 * 按「轮次引用未变则整轮复用」的判据做展平，返回本次实际重算的轮次数。
 * 与 `useAgentRust.ts` 的 `flatRowCache` 判据一致（引用相等），用于门禁侧复现该热路径。
 */
function flattenWithRefCache(turns: Turn[], cache: Map<string, FlatCacheEntry>): number {
  let recomputed = 0
  for (const t of turns) {
    const hit = cache.get(t.id)
    if (hit && hit.turn === t) continue
    cache.set(t.id, { turn: t, rows: flattenTurn(t) })
    recomputed++
  }
  return recomputed
}

describe('C1 校准与判别力自证', () => {
  it('校准公式锁定：ceil(参考期望 × 2 × 1.25)', () => {
    expect(ciTimeBudget(200)).toBe(500)
    expect(ciTimeBudget(0)).toBe(0)
    expect(BUDGET_MS.reduceSession).toBe(ciTimeBudget(REFERENCE_MS.reduceSession))
    expect(BUDGET_MS.thinkSummaryBatched).toBe(ciTimeBudget(REFERENCE_MS.thinkSummaryBatched))
  })

  it('判别力：历史记录样本在预算内接受、在参考期望下拒绝', () => {
    // 历史记录样本（较慢端点）：必须在参考期望下被判红、在 CI 预算内被接受
    const recorded = [7.8, 11.4]
    for (const value of recorded) {
      expect(() => expectWithinBudget(value, REFERENCE_MS.reduceSession)).toThrow()
      expectWithinBudget(value, BUDGET_MS.reduceSession)
    }
    // 预算数值本身锁定：改 REFERENCE_MS 必须同步改这里（门禁常量变更显式可见）
    expect(BUDGET_MS.reduceSession).toBe(13)
    expect(BUDGET_MS.thinkSummaryBatched).toBe(1)
    expect(() => expectWithinBudget(BUDGET_MS.reduceSession + 1, BUDGET_MS.reduceSession)).toThrow()
  })
})

describe('路径① 会话首开 / 重开（归约 + 展平）', () => {
  const events = syntheticSession()

  it('全量回放归约在预算内', () => {
    const turns = reduceEvents([], events)
    const cost = measureMedian(() => {
      reduceEvents([], events)
    })
    report('path1-reduce-session', {
      events: events.length,
      turns: turns.length,
      medianMs: cost,
      perEventMs: cost / events.length,
      budgetMs: BUDGET_MS.reduceSession,
      referenceMs: REFERENCE_MS.reduceSession,
    })
    expectWithinBudget(cost, BUDGET_MS.reduceSession)
  })

  it('全量展平在预算内', () => {
    const turns = reduceEvents([], events)
    const cost = measureMedian(() => {
      flattenTurns(turns)
    })
    report('path1-flatten-session', {
      turns: turns.length,
      medianMs: cost,
      budgetMs: BUDGET_MS.flattenSession,
      referenceMs: REFERENCE_MS.flattenSession,
    })
    expectWithinBudget(cost, BUDGET_MS.flattenSession)
  })

  it('重开（增量展平）：引用未变的轮次必须整轮复用', () => {
    const turns = reduceEvents([], events)

    // ── 逻辑判定（不参与计时）：冷全量 / 单轮变化 / 全命中 —— 重算数必须精确 ──
    const coldCache = new Map<string, FlatCacheEntry>()
    expect(flattenWithRefCache(turns, coldCache)).toBe(turns.length)
    // 仅末轮「被新事件触及」（对象引用变化 → 新对象），其余 199 轮引用不变 → 只重算 1 轮
    const touched = [...turns]
    touched[touched.length - 1] = { ...touched[touched.length - 1] }
    const staleCache = new Map(turns.map((t) => [t.id, { turn: t, rows: flattenTurn(t) }]))
    expect(flattenWithRefCache(touched, staleCache)).toBe(1)
    // 全命中（无任何引用变化）→ 0 重算
    const warmCache = new Map(turns.map((t) => [t.id, { turn: t, rows: flattenTurn(t) }]))
    expect(flattenWithRefCache(turns, warmCache)).toBe(0)

    // ── 性能：全命中重开路径（每轮 Map.get）相对冷全量展平的加速比 ──
    const fullCost = measureMedian(() => {
      flattenTurns(turns)
    })
    const untouchedCache = new Map(turns.map((t) => [t.id, { turn: t, rows: flattenTurn(t) }]))
    const warmCost = measureMedian(() => {
      flattenWithRefCache(turns, untouchedCache)
    })
    const speedup = fullCost / Math.max(warmCost, 1e-6)
    report('path1-reopen', {
      turns: turns.length,
      fullMs: fullCost,
      warmMs: warmCost,
      speedup,
      speedupMin: FLATTEN_INCREMENTAL_SPEEDUP_MIN,
    })
    expect(speedup).toBeGreaterThanOrEqual(FLATTEN_INCREMENTAL_SPEEDUP_MIN)
  })
})

describe('路径③ 流式 delta 消费（单轮长流式，含推理专项）', () => {
  /**
   * 生产形状的每 delta 消费：归约 → 引用缓存展平（只重算被触及的轮次）。
   * 返回 [总耗时, 重算轮次总数]——重算总数必须等于 delta 数（一轮内每 delta 一个新轮次对象），
   * 若归约器改为原地修改，缓存将永不命中，重算总数会退化为 delta × 轮数 → 门禁即红。
   */
  function consumeStream(events: TurnEvent[]): { ms: number; recomputed: number } {
    let turns: Turn[] = []
    const cache = new Map<string, FlatCacheEntry>()
    let recomputed = 0
    const start = performance.now()
    for (const event of events) {
      turns = reduceEvent(turns, event)
      recomputed += flattenWithRefCache(turns, cache)
    }
    return { ms: performance.now() - start, recomputed }
  }

  it('推理流式：500 delta 每 delta 只重算 1 个轮次', () => {
    const events = syntheticReasoningTurn(REASONING_DELTAS)
    let result = { ms: 0, recomputed: 0 }
    const cost = measureMedian(() => {
      result = consumeStream(events)
    })
    report('path3-reasoning-consume', {
      deltas: REASONING_DELTAS,
      medianMs: cost,
      perDeltaMs: cost / REASONING_DELTAS,
      recomputedTurns: result.recomputed,
      budgetMs: BUDGET_MS.consumeReasoningStream,
      referenceMs: REFERENCE_MS.consumeReasoningStream,
    })
    // 语义：每 delta 至多重算 1 个轮次（单轮流式 → 等于 delta 数）
    expect(result.recomputed).toBeLessThanOrEqual(events.length)
    expectWithinBudget(cost, BUDGET_MS.consumeReasoningStream)
  })

  it('正文流式：500 delta 消费在预算内', () => {
    const events = syntheticTurn(0, 0, REASONING_DELTAS)
    const cost = measureMedian(() => {
      consumeStream(events)
    })
    report('path3-text-consume', {
      deltas: REASONING_DELTAS,
      medianMs: cost,
      perDeltaMs: cost / REASONING_DELTAS,
      budgetMs: BUDGET_MS.consumeTextStream,
      referenceMs: REFERENCE_MS.consumeTextStream,
    })
    expectWithinBudget(cost, BUDGET_MS.consumeTextStream)
  })

  it('长历史 + 流式：每 delta 重算轮次数不随历史规模增长', () => {
    // 200 轮历史首开（冷缓存），随后单轮流式：每 delta 必须只重算 1 轮（不是 200 轮）
    const history = syntheticSession()
    const historyTurns = reduceEvents([], history)
    const cache = new Map<string, FlatCacheEntry>()
    flattenWithRefCache(historyTurns, cache)

    const events = syntheticReasoningTurn(REASONING_DELTAS, historyTurns.length)
    let turns = historyTurns
    let maxPerDelta = 0
    for (const event of events) {
      turns = reduceEvent(turns, event)
      maxPerDelta = Math.max(maxPerDelta, flattenWithRefCache(turns, cache))
    }
    report('path3-long-history-stream', {
      historyTurns: historyTurns.length,
      deltas: events.length,
      maxRecomputedPerDelta: maxPerDelta,
    })
    expect(turns.length).toBe(historyTurns.length + 1)
    expect(maxPerDelta).toBe(1)
  })
})

describe('推理专项：thinkSummary（摘要成本预算与判别力）', () => {
  const CALLS = 200
  const MULTILINE = syntheticReasoningText(64_000, false)
  const SINGLE_LINE = syntheticReasoningText(64_000, true)

  it('定向扫描摘要在预算内，且相对全文切分实现显著更快（判别力）', () => {
    const fast = measureMedian(() => {
      for (let i = 0; i < CALLS; i++) thinkSummary(MULTILINE, true)
    })
    const fastSingle = measureMedian(() => {
      for (let i = 0; i < CALLS; i++) thinkSummary(SINGLE_LINE, true)
    })
    const slow = measureMedian(
      () => {
        for (let i = 0; i < CALLS; i++) referenceThinkSummary(MULTILINE, true)
      },
      3,
    )
    const speedup = slow / Math.max(fast, 1e-6)
    report('reasoning-think-summary', {
      calls: CALLS,
      chars: MULTILINE.length,
      multilineMs: fast,
      singleLineMs: fastSingle,
      referenceMs: slow,
      speedup,
      speedupMin: SUMMARY_SPEEDUP_MIN,
      multilineBudgetMs: BUDGET_MS.thinkSummaryBatched,
      singleLineBudgetMs: BUDGET_MS.thinkSummarySingleLineBatched,
      referenceExpectedMs: REFERENCE_MS.thinkSummaryBatched,
    })
    expectWithinBudget(fast, BUDGET_MS.thinkSummaryBatched)
    expectWithinBudget(fastSingle, BUDGET_MS.thinkSummarySingleLineBatched)
    // 判别力：多行文本下，预算必须能捕获「退回全文逐行切分」这一回归
    expect(slow).toBeGreaterThan(BUDGET_MS.thinkSummaryBatched)
    expect(speedup).toBeGreaterThanOrEqual(SUMMARY_SPEEDUP_MIN)
  })
})

describe('C2 流式 Markdown 增量（回归保护）', () => {
  const doc = buildMarkdownDoc()
  // 帧粒度 100 字符：门禁关注「增量 vs 整段」的比值与绝对预算，过大帧数只会拉长门禁耗时
  const frames = markdownFrames(doc, 100)

  it('增量拼接结果与整段渲染一致（每帧不变量；未闭合围栏帧按约定降级，另见 C2 契约测试）', () => {
    const renderer = createMarkdownStreamRenderer()
    let checked = 0
    for (const frame of frames) {
      const incremental = renderer.render(frame)
      if (hasUnclosedFence(frame)) continue
      expect(incremental.stableHtml + incremental.tailHtml).toBe(renderFullMarkdown(frame, null))
      checked++
    }
    expect(checked).toBeGreaterThan(0)
    // 终态（整篇）必须与整段渲染一致
    const final = createMarkdownStreamRenderer().render(doc)
    expect(final.stableHtml + final.tailHtml).toBe(renderFullMarkdown(doc, null))
  })

  it('逐帧增量渲染在预算内，且显著快于整段重渲', () => {
    const incremental = measureMedian(() => {
      const renderer = createMarkdownStreamRenderer()
      for (const frame of frames) renderer.render(frame)
    })
    const full = measureMedian(
      () => {
        for (const frame of frames) renderFullMarkdown(frame, null)
      },
      3,
    )
    const speedup = full / Math.max(incremental, 1e-6)
    report('c2-markdown-stream', {
      frames: frames.length,
      chars: doc.length,
      incrementalMs: incremental,
      fullMs: full,
      speedup,
      speedupMin: MARKDOWN_INCREMENTAL_SPEEDUP_MIN,
      budgetMs: BUDGET_MS.markdownIncrementalFrames,
    })
    expectWithinBudget(incremental, BUDGET_MS.markdownIncrementalFrames)
    expect(speedup).toBeGreaterThanOrEqual(MARKDOWN_INCREMENTAL_SPEEDUP_MIN)
  })
})

describe('代码高亮专项：内容键 memo（Prism 不得被重复请求）', () => {
  const CALLS = 50
  const CODE = syntheticCodeSnippet(60)

  it('同一份源码重复请求在预算内，且显著快于直接调 Prism（判别力）', () => {
    const memoized = measureMedian(() => {
      for (let i = 0; i < CALLS; i++) highlightCode(CODE, 'ts')
    })
    const raw = measureMedian(
      () => {
        for (let i = 0; i < CALLS; i++) referenceHighlightCode(CODE, 'ts')
      },
      3,
    )
    const speedup = raw / Math.max(memoized, 1e-6)
    report('highlight-memo', {
      calls: CALLS,
      chars: CODE.length,
      memoizedMs: memoized,
      rawPrismMs: raw,
      speedup,
      speedupMin: HIGHLIGHT_MEMO_SPEEDUP_MIN,
      budgetMs: BUDGET_MS.highlightMemoizedBatched,
      referenceExpectedMs: REFERENCE_MS.highlightMemoizedBatched,
    })
    expectWithinBudget(memoized, BUDGET_MS.highlightMemoizedBatched)
    // 判别力：预算必须能捕获「退回每次直调 Prism」这一回归
    expect(raw).toBeGreaterThan(BUDGET_MS.highlightMemoizedBatched)
    expect(speedup).toBeGreaterThanOrEqual(HIGHLIGHT_MEMO_SPEEDUP_MIN)
  })

  it('memo 输出与直接调 Prism 逐字节一致（缓存不改变结果）', () => {
    expect(highlightCode(CODE, 'ts')).toBe(referenceHighlightCode(CODE, 'ts'))
    expect(highlightCode(CODE, 'typescript')).toBe(referenceHighlightCode(CODE, 'ts'))
  })
})

describe('基线报告汇总', () => {
  it('打印门禁规模与预算总表', () => {
    report('budgets', {
      samples: SAMPLES,
      referenceMs: REFERENCE_MS,
      budgetMs: BUDGET_MS,
      textDeltasSample: syntheticTextDeltas(3),
    })
    expect(Object.keys(BUDGET_MS)).toHaveLength(Object.keys(REFERENCE_MS).length)
  })
})
