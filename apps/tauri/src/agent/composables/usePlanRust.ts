/** usePlanRust：Rust 编排图（Plan→Execute→[Reflection→Refine]）Tauri 适配器。
 *  封装 `orchestrator_run_plan` 命令 + 监听 `agent:event:reflection:{session_id}` 评审事件。
 *  计划步骤进度复用现有 `agent:event:plan_created/plan_update` 通道（useAgentRust 已驱动 usePlanStore）。 */

import { ref, readonly } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
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
/** 当前会话的评审历史（每次 runPlan 前清空） */
const reflections = ref<ReflectionResultPayload[]>([])
let unlistenReflection: UnlistenFn | null = null

/** 幂等监听评审事件（按当前会话） */
async function setupReflectionListener(sessionId: string): Promise<void> {
  if (unlistenReflection) return
  unlistenReflection = await listen<{ result: ReflectionResultPayload }>(
    `agent:event:reflection:${sessionId}`,
    (e) => {
      reflections.value.push(e.payload.result)
    },
  )
}

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
  reflections.value = []
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
  reflections.value = []
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
