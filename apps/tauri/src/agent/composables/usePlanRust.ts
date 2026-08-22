/** usePlanRust：Rust 编排图（Plan→Execute→[Reflection→Refine]）Tauri 适配器，详细见 docs/details/注释/tauri/usePlanRust.md。
 *  封装 `orchestrator_run_plan` 命令 + 监听 `agent:event:reflection:{session_id}` 评审事件。
 *  评审历史按会话分桶（Map），监听器按会话注册/清理——切换会话不串桶、不覆盖。
 *  计划步骤进度复用现有 `agent:event:plan_created/plan_update` 通道（useAgentRust 已驱动 usePlanStore）。 */

import { ref, readonly, computed, watch } from 'vue'
import { invoke } from './transport'
import { listen, type UnlistenFn } from './transport'
import { useAgentRust } from './useAgentRust'

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

/** Rust OrchestratorResult 镜像（status 为 snake_case 序列化） */
export interface OrchestratorResult {
  status: 'completed' | 'aborted' | 'error' | 'timeout'
  finalMessage: string | null
  iterations: number
  error: string | null
  finalState: Record<string, unknown>
}

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

// ─── 单例状态 ───────────────────────────────────────────────

const running = ref(false)
const error = ref('')
const lastResult = ref<OrchestratorResult | null>(null)
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

// ─── 方法 ───────────────────────────────────────────────────

/** 运行 Plan-and-Execute 编排图（refine=true 时附带 Reflection/Self-Refine 循环） */
async function runPlan(input: string, options: PlanRunOptions = {}): Promise<OrchestratorResult> {
  const sessionId = currentSessionId.value
  if (!sessionId) {
    error.value = '无活动会话，请先新建或切换会话'
    throw new Error(error.value)
  }
  running.value = true
  error.value = ''
  lastResult.value = null
  // 并行清理上一轮的旧监听（若残留）+ 清空本会话分桶——每次运行以本会话现场为准
  teardownReflectionListener(sessionId)
  reflectionBuckets.value.set(sessionId, [])
  try {
    await setupReflectionListener(sessionId)
    const result = await invoke<OrchestratorResult>('orchestrator_run_plan', {
      sessionId,
      input,
      options: {
        refine: options.refine ?? false,
        maxItems: options.maxItems ?? 10,
        maxRefineIterations: options.maxRefineIterations ?? 3,
      },
    })
    lastResult.value = result
    // 编排图"完成但内部失败"（如计划解析失败/LLM 调用失败）时，
    // invoke 不抛错，需把 result.error 显式反映到错误提示，避免静默失败
    if (result.error) {
      error.value = `编排完成但出错：${result.error}`
    }
    return result
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    running.value = false
  }
}

/** 清空本会话的评审历史 */
function clearReflections(): void {
  const sid = currentSessionId.value
  if (sid) reflectionBuckets.value.set(sid, [])
}

export function usePlanRust() {
  return {
    running: readonly(running),
    error: readonly(error),
    lastResult: readonly(lastResult),
    reflections: readonly(reflections),
    runPlan,
    clearReflections,
  }
}
