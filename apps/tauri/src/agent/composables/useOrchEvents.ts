/** useOrchEvents：ToT/GoT 思维树 + Supervisor 委派的实时事件（按会话隔离），详细见 docs/details/注释/tauri/useOrchEvents.md
 *  订阅 Rust 事件桥两类通道：
 *  - `agent:event:orch:{session_id}`：ToT/GoT 思维树（node_created/node_scored/…/terminated）
 *  - `agent:event:orch_supervisor:{session_id}`：Supervisor 委派进度（task_assigned/sub_agent_started/sub_agent_completed）
 *  由 useAgentRust 会话生命周期（newSession/switchSession）注册监听，本模块只暴露 **active 会话**的桶供面板只读。
 *  权威存储为 useSessionViewState（按 sessionId 桶 + localStorage 持久化）：切换会话即水合该会话上次思维树/委派现场。
 *  每次发起新运行（OrchestratorPanel.runPerformed）需先 resetOrchAll() 清空 active 桶。 */

import { computed } from 'vue'
import { listen, type UnlistenFn } from './transport'
import { useSessionViewState, type SessionOrchView } from './useSessionViewState'

// ─── 类型（与 commands.rs emit_orch / emit_orch_supervisor 的 `{ kind, payload }` 对齐）────────

/** ToT/GoT 思维树节点（node_created 建立，node_scored 补分） */
export interface OrchNode {
  id: string
  /** 父节点 id（根节点为 null） */
  parentId: string | null
  depth: number
  /** 思维内容（node_created 为预览；goal_reached 以完整内容覆盖） */
  text: string
  score?: number
  reasoning?: string
}

/** 思维树运行状态 */
export type OrchStatus = 'idle' | 'running' | 'goal' | 'terminated'

/** Supervisor 委派任务（按 sub_agent_id 聚合） */
export interface OrchTask {
  subAgentId: string
  subAgentName: string
  taskDescription: string
  status: 'assigned' | 'running' | 'completed'
  /** 输出字符数（completed 后回填） */
  outputChars?: number
  /** 执行耗时 ms（completed 后回填） */
  durationMs?: number
}

/** orch 事件 payload（双层结构，见 Rust emit_orch） */
interface OrchPayload {
  kind: string
  payload: {
    thoughtId?: string
    parentId?: string | null
    depth?: number
    contentPreview?: string
    content?: string
    score?: number
    reasoning?: string | null
    aggregatedThoughtId?: string
    sourceIds?: string[]
    reason?: string
    totalNodes?: number
    bestThoughtId?: string | null
    bestScore?: number | null
    // supervisor
    subAgentId?: string
    subAgentName?: string
    taskDescription?: string
    outputChars?: number
    durationMs?: number
  }
}

// ─── active 桶视图（由 useSessionViewState.activeSessionId 驱动，切换会话自动跟随）────────

const activeOrch = computed<SessionOrchView | null>(() => {
  const vs = useSessionViewState()
  const id = vs.activeSessionId.value
  if (!id) return null
  return vs.getState(id).orch
})

/** 实时思维树节点（ToT/GoT 共用通道，按出现顺序追加） */
const orchNodes = computed<OrchNode[]>(() => activeOrch.value?.nodes ?? [])
/** 思维树运行状态 */
const orchStatus = computed<OrchStatus>(() => activeOrch.value?.status ?? 'idle')
/** 终止原因（terminated 后回填） */
const orchReason = computed<string>(() => activeOrch.value?.reason ?? '')
/** 终止时的最优节点（bestThoughtId/bestScore） */
const orchBest = computed<{ thoughtId: string; score: number } | null>(() => activeOrch.value?.best ?? null)
/** 实时委派任务日志（Supervisor） */
const supervisorTasks = computed<OrchTask[]>(() => activeOrch.value?.supervisorTasks ?? [])

/** 清空一轮编排的实时状态（新运行前调用；无参清 active 桶，可显式传 sessionId） */
function resetOrchAll(sessionId?: string): void {
  const vs = useSessionViewState()
  const sid = sessionId ?? vs.activeSessionId.value
  if (sid) vs.resetOrch(sid)
}

// ─── 思维树状态更新（ToT/GoT；写入指定会话桶）──────────────────

function applyOrchEvent(p: OrchPayload['payload'], kind: string, sessionId: string): void {
  const vs = useSessionViewState()
  vs.mutateOrch(sessionId, (o) => {
    switch (kind) {
      case 'node_created': {
        o.nodes.push({
          id: p.thoughtId ?? '',
          parentId: p.parentId ?? null,
          depth: p.depth ?? 0,
          text: p.contentPreview ?? '',
        })
        o.status = o.status === 'goal' || o.status === 'terminated' ? o.status : 'running'
        break
      }
      case 'node_scored': {
        const n = o.nodes.find((x) => x.id === p.thoughtId)
        if (n) {
          n.score = p.score
          n.reasoning = p.reasoning ?? undefined
        }
        break
      }
      case 'aggregated': {
        // GoT 聚合产生新节点：保留源节点，追加聚合节点（汇总视角节点的 text 从预览取）
        o.nodes.push({
          id: p.aggregatedThoughtId ?? '',
          parentId: null,
          depth: p.depth ?? 0,
          text: p.contentPreview ?? '',
        })
        o.status = 'running'
        break
      }
      case 'goal_reached': {
        o.status = 'goal'
        const n = o.nodes.find((x) => x.id === p.thoughtId)
        if (n && p.content) {
          n.text = p.content
          if (p.score != null) n.score = p.score
        }
        break
      }
      case 'terminated': {
        o.status = 'terminated'
        o.reason = p.reason ?? ''
        if (p.bestThoughtId) {
          o.best = { thoughtId: p.bestThoughtId, score: p.bestScore ?? 0 }
        }
        break
      }
    }
  })
}

// ─── Supervisor 任务日志更新（写入指定会话桶）───────────────

function applySupervisorEvent(p: OrchPayload['payload'], kind: string, sessionId: string): void {
  const vs = useSessionViewState()
  vs.mutateOrch(sessionId, (o) => {
    const tasks = o.supervisorTasks
    switch (kind) {
      case 'task_assigned': {
        tasks.push({
          subAgentId: p.subAgentId ?? '',
          subAgentName: p.subAgentName ?? p.subAgentId ?? '',
          taskDescription: p.taskDescription ?? '',
          status: 'assigned',
        })
        break
      }
      case 'sub_agent_started': {
        const t = tasks.find((x) => x.subAgentId === p.subAgentId && x.status === 'assigned')
        if (t) t.status = 'running'
        break
      }
      case 'sub_agent_completed': {
        const t = tasks.find((x) => x.subAgentId === p.subAgentId && x.status === 'running')
        if (t) {
          t.status = 'completed'
          t.outputChars = p.outputChars
          t.durationMs = p.durationMs
        }
        break
      }
    }
  })
}

// ─── 事件监听（按 sessionId 注册/清理，由 useAgentRust 会话生命周期驱动）────────

const orchUnlistenFns = new Map<string, UnlistenFn>()
const orchSupervisorUnlistenFns = new Map<string, UnlistenFn>()

/** 为指定会话设置 ToT/GoT 思维树事件监听（幂等；事件写入该会话桶） */
async function setupOrchListener(sessionId: string): Promise<void> {
  if (orchUnlistenFns.has(sessionId)) return
  const eventName = `agent:event:orch:${sessionId}`
  try {
    const unlisten = await listen<OrchPayload>(eventName, (e) => {
      applyOrchEvent(e.payload.payload, e.payload.kind, sessionId)
    })
    orchUnlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useOrchEvents] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定会话的思维树事件监听 */
function teardownOrchListener(sessionId: string): void {
  const unlisten = orchUnlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    orchUnlistenFns.delete(sessionId)
  }
}

/** 为指定会话设置 Supervisor 委派事件监听（幂等；事件写入该会话桶） */
async function setupOrchSupervisorListener(sessionId: string): Promise<void> {
  if (orchSupervisorUnlistenFns.has(sessionId)) return
  const eventName = `agent:event:orch_supervisor:${sessionId}`
  try {
    const unlisten = await listen<OrchPayload>(eventName, (e) => {
      applySupervisorEvent(e.payload.payload, e.payload.kind, sessionId)
    })
    orchSupervisorUnlistenFns.set(sessionId, unlisten)
  } catch (err) {
    console.error(`[useOrchEvents] listen ${eventName} 失败:`, err)
  }
}

/** 清理指定会话的 Supervisisor 委派事件监听 */
function teardownOrchSupervisorListener(sessionId: string): void {
  const unlisten = orchSupervisorUnlistenFns.get(sessionId)
  if (unlisten) {
    unlisten()
    orchSupervisorUnlistenFns.delete(sessionId)
  }
}

// ─── 导出 ───────────────────────────────────────────────────

export function useOrchEvents() {
  return {
    // 实时状态（active 会话桶，组件只读使用；切换会话自动跟随）
    orchNodes,
    orchStatus,
    orchReason,
    orchBest,
    supervisorTasks,
    // 方法
    resetOrchAll,
    setupOrchListener,
    teardownOrchListener,
    setupOrchSupervisorListener,
    teardownOrchSupervisorListener,
  }
}
