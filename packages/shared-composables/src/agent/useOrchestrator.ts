/**
 * # useOrchestrator — 子 Agent 编排（端分离批次2）
 *
 * 端分离批次2：从 src/agent/composables/useOrchestrator.ts 迁移至 shared-composables。
 * 仅类型依赖 IAgentBackend（已参数化），longTaskStore 路径调整为 ./long-task/longTaskStore。
 */

import { reactive, ref, onMounted, onBeforeUnmount } from 'vue'
import type { AgentInfo, AgentType, SubAgentTask } from '@agent/orchestrator/types'
import { AGENT_TYPE_CONFIG } from '@agent/orchestrator/types'
import type { IAgentBackend } from '@agent/index'
import { saveTask, updateTask } from './long-task/longTaskStore'
import type { LongTaskRecord } from './long-task/longTaskStore'

interface PipelineContext {
  pipelineId: string
  stepId: string
}

export interface SubAgentState {
  id: string
  type: AgentType
  icon: string
  name: string
  status: AgentInfo['status']
  visible: boolean
  messages: any[]
  result: string | null
  startedAt: number | null
  completedAt: number | null
  duration: number | null
  error: string | null
  /** 创作编排上下文，子 Agent 完成后自动更新 Pipeline 步骤状态 */
  pipelineContext?: PipelineContext
}

type ExecuteFn = (task: {
  id: string
  type: AgentType
  prompt: string
  skillIds: string[]
  /** 任务 4 P4：已废弃，子 Agent 不再设超时（长任务无中断） */
  timeout?: number
  images?: { data: string; mimeType: string }[]
}) => Promise<{ success: boolean; output: string; duration: number }>

const subAgents = reactive<Map<string, SubAgentState>>(new Map())
const maxConcurrency = ref(3)
let executeFn: ExecuteFn | null = null
let listenersAttached = false
let activeExecutions: Map<string, AbortController> = new Map()

// 子 Agent 长任务跟踪（checkpoint + 心跳，复用 longTaskStore 持久层），详细见 docs/details/注释/packages/shared-composables/agent/useOrchestrator.md
interface ActiveSubLongTask {
  unsub: () => void
  turnCount: number
}
const activeLongTasks = new Map<string, ActiveSubLongTask>()
let subHeartbeatTimer: ReturnType<typeof setInterval> | null = null
const SUB_HEARTBEAT_INTERVAL_MS = 5_000

function ensureSubHeartbeat(): void {
  if (subHeartbeatTimer) return
  subHeartbeatTimer = setInterval(async () => {
    for (const taskId of activeLongTasks.keys()) {
      await updateTask(taskId, { lastHeartbeatAt: Date.now() })
    }
  }, SUB_HEARTBEAT_INTERVAL_MS)
}

function stopSubHeartbeatIfEmpty(): void {
  if (activeLongTasks.size === 0 && subHeartbeatTimer) {
    clearInterval(subHeartbeatTimer)
    subHeartbeatTimer = null
  }
}

/** 跟踪子 Agent 长任务：持久化 + 事件 checkpoint + 心跳 */
export function trackSubAgentLongTask(taskId: string, subBackend: IAgentBackend, prompt: string, agentType: string): void {
  // 持久化初始记录
  const record: LongTaskRecord = {
    taskId,
    type: 'sub-agent',
    status: 'running',
    startedAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    turnCount: 0,
    checkpoint: { agentMessages: [], lastUserText: prompt },
    meta: { prompt, agentType },
  }
  saveTask(record)

  // 订阅事件 checkpoint（turn_end 递增轮次 + 快照 messages；tool_execution_start 记录当前 tool）
  let turnCount = 0
  const unsub = subBackend.subscribe((event: any) => {
    if (!activeLongTasks.has(taskId)) return
    if (event.type === 'turn_end') {
      turnCount++
      const messages = subBackend.getRuntimeMessages?.() ?? []
      updateTask(taskId, {
        turnCount,
        checkpoint: { agentMessages: messages, lastUserText: prompt },
      })
    } else if (event.type === 'tool_execution_start' && event.toolCall?.name) {
      updateTask(taskId, { currentTool: event.toolCall.name })
    }
  })

  activeLongTasks.set(taskId, { unsub, turnCount: 0 })
  ensureSubHeartbeat()
  console.log(`[SubAgentLongTask] 跟踪子 Agent 长任务 ${taskId}（类型: ${agentType}）`)
}

/** 终止跟踪子 Agent 长任务：终态持久化 + 清理订阅/心跳 */
export async function untrackSubAgentLongTask(
  taskId: string,
  status: 'completed' | 'failed' | 'cancelled',
): Promise<void> {
  const task = activeLongTasks.get(taskId)
  if (task) {
    task.unsub()
    activeLongTasks.delete(taskId)
  }
  // updateTask 对不存在的记录会静默 warn（createSubBackend 失败时 track 未调用），无副作用
  await updateTask(taskId, { status, endedAt: Date.now() })
  stopSubHeartbeatIfEmpty()
  console.log(`[SubAgentLongTask] 子 Agent 长任务 ${taskId} 终态: ${status}`)
}

function syncToWindow(): void {
  try {
    ; (window as any).__worldsea_sub_agents = subAgents
  } catch { }
}

/** 子 Agent 完成后自动更新 Pipeline 步骤状态 */
async function autoUpdatePipelineStep(
  ctx: PipelineContext,
  success: boolean,
  output: string,
): Promise<void> {
  try {
    const { useEntityStore } = await import('@worldsea/entity-core')
    const store = useEntityStore()
    const entity = await store.getById(ctx.pipelineId)
    if (!entity || entity.type !== 'pipeline') return

    const p = entity.properties || {}
    let steps: any[] = []
    try { steps = JSON.parse((p.steps as string) || '[]') } catch { return }

    const idx = steps.findIndex((s: any) => s.id === ctx.stepId)
    if (idx < 0) return

    if (success) {
      steps[idx] = { ...steps[idx], status: 'completed', output: { summary: output.slice(0, 500) } }
    } else {
      steps[idx] = { ...steps[idx], status: 'failed', output: { summary: `失败: ${output.slice(0, 200)}` } }
    }

    // 检查是否所有步骤都完成（包含失败，因失败步骤可重试）
    const allTerminal = steps.every(
      (s: any) => s.status === 'completed' || s.status === 'skipped' || s.status === 'failed',
    )
    const anyPendingOrRunning = steps.some(
      (s: any) => s.status === 'pending' || s.status === 'running',
    )

    // 只有全部步骤终态且无待执行时才判断最终状态
    let newStatus: string
    if (allTerminal && !anyPendingOrRunning) {
      const anyFailed = steps.some((s: any) => s.status === 'failed')
      newStatus = anyFailed ? 'failed' : 'completed'
    } else {
      newStatus = 'running'
    }

    await store.update(ctx.pipelineId, {
      properties: {
        ...p,
        steps: JSON.stringify(steps),
        status: newStatus,
        ...(allTerminal ? { currentStepId: null } : {}),
      },
    }, 'agent')
  } catch (err) {
    console.error('[useOrchestrator] autoUpdatePipelineStep failed:', err)
  }
}

export function useOrchestrator() {
  function getSubAgents(): SubAgentState[] {
    return Array.from(subAgents.values())
  }

  function getActiveSubAgents(): SubAgentState[] {
    return Array.from(subAgents.values()).filter(a => a.status === 'running')
  }

  function addSubAgent(task: SubAgentTask): void {
    const typeConfig = AGENT_TYPE_CONFIG[task.type]
    subAgents.set(task.id, {
      id: task.id,
      type: task.type,
      icon: typeConfig.icon,
      name: typeConfig.name,
      status: 'pending',
      visible: true,
      messages: [],
      result: null,
      startedAt: null,
      completedAt: null,
      duration: null,
      error: null,
      pipelineContext: task.pipelineContext,
    })
    syncToWindow()
  }

  function updateSubAgentStatus(id: string, status: AgentInfo['status'], error?: string): void {
    const agent = subAgents.get(id)
    if (!agent) return
    agent.status = status
    if (error) agent.error = error
    if (status === 'running' && !agent.startedAt) agent.startedAt = Date.now()
    if (status === 'completed' || status === 'failed' || status === 'timeout' || status === 'cancelled') {
      agent.completedAt = Date.now()
      if (agent.startedAt) agent.duration = agent.completedAt - agent.startedAt
    }
    syncToWindow()
  }

  function setSubAgentResult(id: string, result: string): void {
    const agent = subAgents.get(id)
    if (!agent) return
    agent.result = result
    syncToWindow()
  }

  function addSubAgentMessage(id: string, message: any): void {
    const agent = subAgents.get(id)
    if (!agent) return
    agent.messages.push(message)
  }

  function toggleSubAgentVisible(id: string): void {
    const agent = subAgents.get(id)
    if (!agent) return
    agent.visible = !agent.visible
  }

  function showSubAgent(id: string): void {
    const agent = subAgents.get(id)
    if (!agent) return
    agent.visible = true
  }

  function hideSubAgent(id: string): void {
    const agent = subAgents.get(id)
    if (!agent) return
    agent.visible = false
  }

  function removeSubAgent(id: string): void {
    subAgents.delete(id)
    syncToWindow()
  }

  function clearCompleted(): void {
    for (const [id, agent] of subAgents) {
      if (agent.status === 'completed' || agent.status === 'failed' || agent.status === 'timeout' || agent.status === 'cancelled') {
        subAgents.delete(id)
      }
    }
    syncToWindow()
  }

  function registerExecutor(fn: ExecuteFn): void {
    executeFn = fn
  }

  async function handleDispatchEvent(e: Event): Promise<void> {
    const detail = (e as CustomEvent).detail
    if (!detail) return

    const { taskId, type, prompt, skillIds } = detail
    const pipelineContext: PipelineContext | undefined = detail.pipelineContext

    if (subAgents.has(taskId)) return

    addSubAgent({
      id: taskId,
      type,
      prompt,
      skillIds,
      pipelineContext,
    })
    updateSubAgentStatus(taskId, 'running')

    if (!executeFn) {
      updateSubAgentStatus(taskId, 'failed', '执行器未注册，无法创建子 Agent')
      return
    }

    const controller = new AbortController()
    activeExecutions.set(taskId, controller)

    try {
      const result = await executeFn({ id: taskId, type, prompt, skillIds: skillIds || [], images: detail.images })
      if (controller.signal.aborted) return
      updateSubAgentStatus(taskId, result.success ? 'completed' : 'failed')
      setSubAgentResult(taskId, result.output)

      // 如果有 Pipeline 上下文，自动更新步骤状态
      if (pipelineContext) {
        await autoUpdatePipelineStep(pipelineContext, result.success, result.output)
        // 成功完成时通知前端自动继续下一个步骤
        if (result.success) {
          window.dispatchEvent(new CustomEvent('worldsea:pipeline-step-completed', {
            detail: {
              pipelineId: pipelineContext.pipelineId,
              stepId: pipelineContext.stepId,
            },
          }))
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return
      const errMsg = err instanceof Error ? err.message : String(err)
      updateSubAgentStatus(taskId, 'failed', errMsg)

      // 子 Agent 失败也更新 Pipeline 步骤状态
      if (pipelineContext) {
        await autoUpdatePipelineStep(pipelineContext, false, errMsg)
      }
    } finally {
      activeExecutions.delete(taskId)
    }
  }

  function handleCancelEvent(e: Event): void {
    const { taskId } = (e as CustomEvent).detail
    const controller = activeExecutions.get(taskId)
    if (controller) {
      controller.abort()
      activeExecutions.delete(taskId)
    }
    updateSubAgentStatus(taskId, 'cancelled')
    // 任务 4 P4：取消时标记子 Agent 长任务为 cancelled（fire-and-forget）
    untrackSubAgentLongTask(taskId, 'cancelled').catch(() => {})
  }

  function handleGetStatusEvent(_e: Event): void {
    syncToWindow()
  }

  function handleDispatchEventWrapper(e: Event): void {
    handleDispatchEvent(e).catch(() => { })
  }

  function attachListeners(): void {
    if (listenersAttached) return
    listenersAttached = true
    window.addEventListener('worldsea:dispatch-sub-agent', handleDispatchEventWrapper)
    window.addEventListener('worldsea:cancel-sub-agent', handleCancelEvent as EventListener)
    window.addEventListener('worldsea:get-sub-agent-status', handleGetStatusEvent as EventListener)
    syncToWindow()
  }

  function detachListeners(): void {
    if (!listenersAttached) return
    listenersAttached = false
    window.removeEventListener('worldsea:dispatch-sub-agent', handleDispatchEventWrapper)
    window.removeEventListener('worldsea:cancel-sub-agent', handleCancelEvent as EventListener)
    window.removeEventListener('worldsea:get-sub-agent-status', handleGetStatusEvent as EventListener)
    try {
      delete (window as any).__worldsea_sub_agents
    } catch { }
  }

  onMounted(() => {
    attachListeners()
  })

  onBeforeUnmount(() => {
    detachListeners()
  })

  return {
    subAgents,
    maxConcurrency,
    getSubAgents,
    getActiveSubAgents,
    addSubAgent,
    updateSubAgentStatus,
    setSubAgentResult,
    addSubAgentMessage,
    toggleSubAgentVisible,
    showSubAgent,
    hideSubAgent,
    removeSubAgent,
    clearCompleted,
    registerExecutor,
    attachListeners,
    detachListeners,
    // 任务 4 P4：子 Agent 长任务跟踪
    trackSubAgentLongTask,
    untrackSubAgentLongTask,
  }
}
