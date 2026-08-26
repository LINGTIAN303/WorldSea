/** usePlanRust：Rust 编排图（Plan→Execute→[Reflection→Refine]）Tauri 适配器，详细见 docs/details/注释/tauri/usePlanRust.md。
 *  经 createOrchestratorRunner 封装 `orchestrator_run_plan` 命令（统一适配器，matrix §8 里程碑 3），
 *  onPrepare 钩子注册/清理 `agent:event:reflection:{session_id}` 评审监听；评审历史按会话分桶（Map）。
 *  计划步骤进度复用现有 `agent:event:plan_created/plan_update` 通道（useAgentRust 已驱动 usePlanStore）。 */

import { computed, ref, watch } from 'vue'
import { listen, type UnlistenFn } from './transport'
import { useAgentRust } from './useAgentRust'
import { createOrchestratorRunner, type OrchestratorResult } from './useOrchestratorRunner'

// 模块级单例：复用 useAgentRust 的当前会话 ref（同一引用）
const { currentSessionId } = useAgentRust()

// ─── 类型（与后端 OrchestratorResult / ReflectionResult 对齐）────────

/** 编排图运行选项（对应 agent-commands::PlanExecuteOptions，camelCase） */
export interface PlanRunOptions {
  /** 是否启用 Reflection/Self-Refine 循环（默认 false = 仅 Plan→Execute） */
  refine?: boolean
  /** 计划最大步骤数（默认 10） */
  maxItems?: number
  /** Reflection→Refine 最大迭代轮数（默认 3） */
  maxRefineIterations?: number
}

// OrchestratorResult 类型经 useOrchestratorRunner 复用（面板 import 本模块旧路径仍可用）

/** 评审问题（对应 agent-runtime::ReflectionIssue） */
export interface ReflectionIssue {
  severity: 'info' | 'warning' | 'error'
  description: string
}

/** 评审结果（对应 agent-runtime::ReflectionResult） */
export interface ReflectionResultPayload {
  target: string
  score: number
  issues: ReflectionIssue[]
  suggestions: string[]
  iteration: number
}

// ─── 单例状态（评审分桶保留本模块；busy/error/result 骨架由统一 runner 承载）────────

/** 评审历史按会话分桶：key=sessionId，value=该会话的评审列表（Map 响应式，切换会话不串桶） */
const reflectionBuckets = ref<Map<string, ReflectionResultPayload[]>>(new Map())
/** 评审监听器清理函数（按 sessionId 索引） */
const reflectionUnlistenFns = new Map<string, UnlistenFn>()

/** 当前会话的评审历史（随 currentSessionId 切换，会话间相互隔离） */
const reflections = computed<ReflectionResultPayload[]>(() => {
  const sid = currentSessionId.value
  return sid ? (reflectionBuckets.value.get(sid) ?? []) : []
})

/** 幂等监听指定会话的评审事件；收到后压入该会话的分桶 */
async function setupReflectionListener(sessionId: string): Promise<void> {
  if (!sessionId || reflectionUnlistenFns.has(sessionId)) return
  try {
    const unlisten = await listen<{ result: ReflectionResultPayload }>(
      `agent:event:reflection:${sessionId}`,
      (e) => {
        const bucket = reflectionBuckets.value.get(sessionId) ?? []
        bucket.push(e.payload.result)
        reflectionBuckets.value.set(sessionId, bucket)
      },
    )
    reflectionUnlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[usePlanRust] listen reflection ${sessionId} 失败:`, err)
  }
}

/** 清理指定会话的评审监听 */
function teardownReflectionListener(sessionId: string): void {
  const unlisten = reflectionUnlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    reflectionUnlistenFns.delete(sessionId)
  }
}

// 切换会话时清理旧会话监听（保留其分桶历史，供切回时展示；跨会话不相互污染）
watch(currentSessionId, (newId, oldId) => {
  if (oldId && oldId !== newId) {
    teardownReflectionListener(oldId)
  }
})

// ─── 统一运行器（createOrchestratorRunner，matrix §8 里程碑 3）──────────────
// onPrepare：每次运行时清理上一轮旧监听 + 清空本会话分桶 + 幂等注册事件监听，
// 再把 run 骨架（会话校验/busy/error/result/error 回显）交给统一工厂。
const { busy, error, result, run } = createOrchestratorRunner('orchestrator_run_plan', {
  onPrepare: async (sessionId) => {
    teardownReflectionListener(sessionId)
    reflectionBuckets.value.set(sessionId, [])
    await setupReflectionListener(sessionId)
  },
})

/** 清空本会话的评审历史 */
function clearReflections(): void {
  const sid = currentSessionId.value
  if (sid) reflectionBuckets.value.set(sid, [])
}

/** 运行 Plan-and-Execute 编排图（refine=true 时附带 Reflection/Self-Refine 循环） */
async function runPlan(input: string, options: PlanRunOptions = {}): Promise<OrchestratorResult> {
  return await run(input, {
    refine: options.refine ?? false,
    maxItems: options.maxItems ?? 10,
    maxRefineIterations: options.maxRefineIterations ?? 3,
  })
}

export function usePlanRust() {
  return {
    running: busy,
    error,
    lastResult: result,
    reflections,
    runPlan,
    clearReflections,
  }
}
