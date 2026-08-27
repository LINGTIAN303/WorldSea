// useOrchestrationTrace — 统一编排迹线聚合（A2 / C13 / M2-1）
//
// 消费 `agent:event:orchestration_trace:{session_id}` 通道（M1-3/M1-9 后端轨迹事件族），
// 按 run_id 聚合成 run 视图（请求 → 阶段 → 物摘要/理由 → 结论），供对话内编排段渲染。
// 通道名刻意与旧 A1 摘要日志 `agent:event:trace` 区分（M1-RK6：payload 结构不同）。
//
// 单例模式（同 useActivityLog）：模块级 reactive 状态，setup/teardown 幂等按会话管理。

import { ref } from 'vue'
import { listen, type UnlistenFn } from './transport'

export type TracePhaseStatus = 'success' | 'degraded' | 'failed' | 'skipped'

/** 后端 orchestration_trace 通道载荷（mimic backend Trace* 事件 payload） */
export interface OrchestrationTracePayload {
  type: 'pipe_started' | 'phase_entered' | 'phase_result' | 'pipe_finished'
  runId: string
  pipeline?: string | null
  reason?: string | null
  phase?: string | null
  status?: TracePhaseStatus | string | null
  summary?: string | null
  artifactId?: string | null
  finalMessage?: string | null
}

/** 阶段视图（折叠态阶段摘要行 + 展开态详情的数据源） */
export interface TracePhaseView {
  phase: string
  status: TracePhaseStatus | 'pending' | 'running'
  summary: string
  artifactId?: string | null
  reason?: string | null
  enteredAt: number
  finishedAt?: number
}

/** run 视图（一次请求的编排段数据源） */
export interface OrchestrationRunView {
  runId: string
  pipeline: string
  /** 判型理由（A1 可纠之"可见"半；pipe_started.reason） */
  reason?: string | null
  phases: TracePhaseView[]
  status: 'running' | 'finished'
  finishedStatus?: string | null
  convergeReason?: string | null
  finalMessage?: string | null
  startedAt: number
  finishedAt?: number
}

function emptyRun(p: OrchestrationTracePayload): OrchestrationRunView {
  return {
    runId: p.runId,
    pipeline: p.pipeline ?? 'default',
    reason: p.reason ?? null,
    phases: [],
    status: 'running',
    startedAt: Date.now(),
  }
}

/** run 聚合表（按 runId） */
const runs = ref<Record<string, OrchestrationRunView>>({})
/** 完成顺序的 run 列表（折叠态历史可重新展开的数据源） */
const finishedRuns = ref<OrchestrationRunView[]>([])
/** 最近一个活跃（运行中）run */
const activeRun = ref<OrchestrationRunView | null>(null)

/** 监听器注册表（按 sessionId，幂等） */
const unlistenFns = new Map<string, UnlistenFn>()

function applyEvent(p: OrchestrationTracePayload): void {
  const run = runs.value[p.runId]
  switch (p.type) {
    case 'pipe_started': {
      const r = emptyRun(p)
      runs.value[p.runId] = r
      activeRun.value = r
      break
    }
    case 'phase_entered': {
      const r = run ?? emptyRun(p)
      // 同 phase 幂等：重复进入不追加重复阶段行
      if (!r.phases.some((ph) => ph.phase === p.phase)) {
        r.phases.push({
          phase: p.phase ?? '',
          status: 'running',
          summary: '',
          reason: p.reason ?? null,
          enteredAt: Date.now(),
        })
      }
      runs.value[p.runId] = r
      activeRun.value = r
      break
    }
    case 'phase_result': {
      const r = run ?? emptyRun(p)
      const existing = r.phases.find((ph) => ph.phase === p.phase)
      const now = Date.now()
      if (existing) {
        existing.status = (p.status as TracePhaseStatus) ?? 'success'
        existing.summary = p.summary ?? ''
        existing.artifactId = p.artifactId ?? null
        existing.finishedAt = now
      } else {
        r.phases.push({
          phase: p.phase ?? '',
          status: (p.status as TracePhaseStatus) ?? 'success',
          summary: p.summary ?? '',
          artifactId: p.artifactId ?? null,
          reason: null,
          enteredAt: now,
          finishedAt: now,
        })
      }
      runs.value[p.runId] = r
      activeRun.value = r
      break
    }
    case 'pipe_finished': {
      const r = run ?? emptyRun(p)
      r.status = 'finished'
      r.finishedStatus = p.status ?? null
      r.convergeReason = p.reason ?? null
      r.finalMessage = p.finalMessage ?? null
      r.finishedAt = Date.now()
      runs.value[p.runId] = r
      if (activeRun.value?.runId === p.runId) {
        activeRun.value = null
      }
      if (!finishedRuns.value.some((fr) => fr.runId === p.runId)) {
        finishedRuns.value = [...finishedRuns.value, r]
      }
      break
    }
  }
}

/** 为指定会话设置 orchestration_trace 监听（幂等） */
async function setupOrchestrationTraceListener(sessionId: string): Promise<void> {
  if (unlistenFns.has(sessionId)) return
  const eventName = `agent:event:orchestration_trace:${sessionId}`
  try {
    const unlisten = await listen<OrchestrationTracePayload>(eventName, (e) => {
      applyEvent(e.payload)
    })
    unlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useOrchestrationTrace] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定会话监听 */
function teardownOrchestrationTraceListener(sessionId: string): void {
  const unlisten = unlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    unlistenFns.delete(sessionId)
  }
}

/** 按 runId 查（历史可重新展开） */
function getRun(runId: string): OrchestrationRunView | null {
  return runs.value[runId] ?? null
}

/** 清空全部 run 状态（切会话时调用） */
function resetOrchestrationTrace(): void {
  runs.value = {}
  finishedRuns.value = []
  activeRun.value = null
}

export function useOrchestrationTrace() {
  return {
    runs,
    finishedRuns,
    activeRun,
    getRun,
    setupOrchestrationTraceListener,
    teardownOrchestrationTraceListener,
    resetOrchestrationTrace,
  }
}