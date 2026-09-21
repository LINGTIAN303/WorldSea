/**
 * 事件行流 → 轮次分组（含整组复用缓存）
 * 详细见 docs/details/注释/packages/shared-ui/agent/stream/groupTurns.md
 *
 * 复用判据：该轮次在窗口内的**源行引用序列逐项全等** → 整组对象（含聚合后的 process 块数组）
 * 原样复用。Vue 对 props 引用未变的子组件跳过 patch，故未变轮次的 ProcessBlocks 不再每 delta 重渲。
 */
import type { AgentStreamItem } from '@worldsea/shared-composables/agent/useAgent'
import { aggregatePlanBlocks, type ProcessBlock } from './aggregatePlanBlocks'

type UserItem = Extract<AgentStreamItem, { type: 'user' }>
type AssistantItem = Extract<AgentStreamItem, { type: 'assistant' }>

/** 轮次分组：一个 Turn 的三层结构 + 尾部行 */
export interface TurnGroup {
  id: string
  /** ① 用户消息层；窗口切片从轮次中间开始时为 null */
  user: UserItem | null
  /** ② 过程层（聚合后的块序列，供 ProcessBlocks 树渲染） */
  process: ProcessBlock[]
  /** ③ 结果层；结果层未落地时为 null */
  result: AssistantItem | null
  /** 结果层之后仍属于本轮次的行（如中止「已停止」分隔行） */
  tail: AgentStreamItem[]
}

/** 分组缓存条目：源行引用序列 + 产出分组（引用即复用凭据） */
export interface GroupCacheEntry {
  src: AgentStreamItem[]
  group: TurnGroup
}

/**
 * 按轮次分组：以 user 行开启新组，isResult 的正文行归为结果层，其后行入 tail。
 *
 * 过程层（process）在分组基础上再做「计划步骤块」聚合：isPlanStep 行作为块头，
 * 其后紧邻的、id 属于该步骤 childRefIds 的行收集为块内子动作（默认折叠可展开）。
 * 分组只做「切段」，不改变行的相对顺序——窗口化依赖渲染顺序与 items 顺序一致。
 *
 * @param items 窗口内的行切片（顺序即文档序）
 * @param cache 跨帧分组缓存（调用方持有；按 turnId 索引）
 */
export function groupTurns(
  items: readonly AgentStreamItem[],
  cache: Map<string, GroupCacheEntry>,
): TurnGroup[] {
  const out: TurnGroup[] = []
  let cur: TurnGroup | null = null
  let src: AgentStreamItem[] = []

  /** 收口当前组：源行引用全等 → 整组复用；否则聚合 process 后入缓存 */
  function flush(): void {
    if (!cur) return
    const prev = cache.get(cur.id)
    if (prev && prev.src.length === src.length && prev.src.every((r, i) => r === src[i])) {
      out[out.length - 1] = prev.group
    } else {
      if (cur.process.length) {
        cur.process = aggregatePlanBlocks(cur.process as unknown as AgentStreamItem[])
      }
      cache.set(cur.id, { src, group: cur })
    }
    cur = null
    src = []
  }

  for (const it of items) {
    if (it.type === 'user') {
      // group.id 取 turnId（折叠 latch 归属用）；旧调用方未带 turnId 时回退行 id
      flush()
      cur = { id: it.turnId ?? it.id, user: it, process: [], result: null, tail: [] }
      src = [it]
      out.push(cur)
      continue
    }
    // 切片从轮次中间开始：造无用户行的组承接，避免行被丢弃
    if (!cur) {
      cur = { id: `orphan-${it.id}`, user: null, process: [], result: null, tail: [] }
      src = []
      out.push(cur)
    }
    if (it.type === 'assistant' && it.isResult) {
      // 同组已存在结果层属异常数据：开新组承载，避免后者覆盖前者
      if (cur.result) {
        flush()
        cur = { id: `tail-${it.id}`, user: null, process: [], result: null, tail: [] }
        src = []
        out.push(cur)
      }
      cur.result = it
    } else if (cur.result) {
      cur.tail.push(it)
    } else {
      cur.process.push(it)
    }
    src.push(it)
  }
  flush()

  // 缓存有界：窗口外的轮次不再渲染，其条目无复用价值（滚动回来重建即可），
  // 超过窗口两倍时清理一次，避免跨会话长期累积（阈值触发 → 摊销 O(1)）。
  if (cache.size > out.length * 2) {
    const live = new Set(out.map((g) => g.id))
    for (const key of cache.keys()) if (!live.has(key)) cache.delete(key)
  }
  return out
}
