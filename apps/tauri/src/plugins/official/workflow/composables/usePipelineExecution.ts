import { ref, computed } from 'vue'
import type {
  CreationPipeline,
  PipelineStep,
  AgentTaskConfig,
  AgentStepPrompt,
} from '../types'
import { usePipeline } from './usePipeline'

/**
 * 创作编排执行器
 *
 * 核心设计：步骤执行由创作子 Agent 完成，前端只做状态展示和用户操作入口。
 * 子 Agent 的派发和状态回调由 useOrchestrator + pipeline-tools.ts 处理，
 * 此模块提供前端侧的执行状态追踪和用户交互功能。
 */

/** 将步骤配置转换为 Agent prompt（前端侧用于日志展示） */
export function stepToAgentPrompt(step: PipelineStep, pipelineName: string): AgentStepPrompt {
  const config = step.config as AgentTaskConfig

  const promptParts: string[] = [
    `[创作编排] 正在执行 Pipeline「${pipelineName}」的步骤「${step.title}」`,
    '',
    `## 任务`,
    config.prompt || step.title,
  ]

  if (config.targetEntityType) {
    promptParts.push('', `## 目标实体类型`, config.targetEntityType)
  }

  if (config.expectedOutput) {
    promptParts.push('', `## 预期输出`, config.expectedOutput)
  }

  return {
    prompt: promptParts.join('\n'),
    skillIds: config.skillIds ?? [],
  }
}

/** 步骤类型对应的子 Agent 类型名称（用于日志展示） */
const STEP_AGENT_LABELS: Record<string, string> = {
  'agent-task': '创作 Agent',
  'batch-create': '批量创作 Agent',
  'consistency-check': '校验 Agent',
  'template-apply': '创作 Agent',
  'transform': '创作 Agent',
  'user-review': '用户审阅',
  // 2026-09-09 接轨：tot/got/multi-agent 由主 Agent 直接调用 pattern_step_run 执行，不派生子 Agent
  'tot-search': '思维树探索（B 轨）',
  'got-solve': '思维图求解（B 轨）',
  'multi-agent': '多智能体协作（B 轨）',
}

export function usePipelineExecution() {
  const { selectedPipeline, updatePipeline, updateStepStatus } = usePipeline()

  const isExecuting = ref(false)
  const currentStepIndex = ref(-1)
  const executionLog = ref<string[]>([])

  /** 当前正在执行的步骤 */
  const currentStep = computed<PipelineStep | null>(() => {
    const pipeline = selectedPipeline.value
    if (!pipeline || currentStepIndex.value < 0) return null
    return pipeline.steps[currentStepIndex.value] ?? null
  })

  /** 执行进度百分比 */
  const progress = computed(() => {
    const pipeline = selectedPipeline.value
    if (!pipeline || pipeline.steps.length === 0) return 0
    return Math.round(
      (pipeline.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length /
        pipeline.steps.length) * 100,
    )
  })

  function log(msg: string) {
    executionLog.value = [...executionLog.value, `[${new Date().toLocaleTimeString()}] ${msg}`]
  }

  /** 找到下一个待执行的步骤索引 */
  function findNextPendingStep(pipeline: CreationPipeline): number {
    return pipeline.steps.findIndex(s => s.status === 'pending' || s.status === 'failed')
  }

  /**
   * 执行单个步骤
   *
   * 注意：实际步骤执行由 Agent 侧的 pipeline_run_step 工具完成，
   * 该工具会通过 CustomEvent 派发创作子 Agent。
   * 前端侧此方法仅用于日志记录和 UI 状态更新。
   * 子 Agent 完成后，useOrchestrator 的 autoUpdatePipelineStep 会自动更新步骤状态。
   */
  async function executeStep(stepId: string): Promise<void> {
    const pipeline = selectedPipeline.value
    if (!pipeline) return

    const stepIndex = pipeline.steps.findIndex(s => s.id === stepId)
    if (stepIndex < 0) return

    const step = pipeline.steps[stepIndex]
    currentStepIndex.value = stepIndex

    const agentLabel = STEP_AGENT_LABELS[step.type] || step.type
    log(`步骤「${step.title}」→ ${agentLabel}`)

    if (step.type === 'user-review') {
      log(`等待用户审阅: ${step.title}`)
    } else {
      log(`子 Agent 执行中: ${step.title}（${agentLabel}）`)
    }
  }

  /** 确认 user-review 步骤 */
  async function confirmReview(stepId: string): Promise<void> {
    const pipeline = selectedPipeline.value
    if (!pipeline) return

    log(`用户确认审阅步骤: ${stepId}`)
    await updateStepStatus(pipeline.id, stepId, 'completed', {
      summary: '用户已审阅通过',
    })
  }

  /** 跳过步骤 */
  async function skipStep(stepId: string): Promise<void> {
    const pipeline = selectedPipeline.value
    if (!pipeline) return

    log(`跳过步骤: ${stepId}`)
    await updateStepStatus(pipeline.id, stepId, 'skipped')
  }

  /** 标记步骤完成（前端侧回调，子 Agent 完成后由 autoUpdatePipelineStep 自动调用） */
  async function markStepCompleted(
    stepId: string,
    output?: { summary: string; entityIds?: string[]; detail?: string },
  ): Promise<void> {
    const pipeline = selectedPipeline.value
    if (!pipeline) return

    log(`步骤完成: ${stepId}`)
    await updateStepStatus(pipeline.id, stepId, 'completed', output ?? { summary: '已完成' })
  }

  /** 标记步骤失败 */
  async function markStepFailed(stepId: string, error: string): Promise<void> {
    const pipeline = selectedPipeline.value
    if (!pipeline) return

    log(`步骤失败: ${stepId} - ${error}`)
    await updateStepStatus(pipeline.id, stepId, 'failed', { summary: `失败: ${error}` })
  }

  /** 自动继续执行下一个步骤（由 Agent 回调触发） */
  async function continueToNextStep(pipelineId: string, _completedStepId: string): Promise<void> {
    const pipeline = selectedPipeline.value
    if (!pipeline || pipeline.id !== pipelineId) return

    // 如果 Pipeline 不是 running 状态，不自动继续
    if (pipeline.status !== 'running') return

    const nextIdx = findNextPendingStep(pipeline)
    if (nextIdx < 0) {
      log('所有步骤已完成')
      return
    }

    const step = pipeline.steps[nextIdx]
    log(`自动继续 → 步骤「${step.title}」`)

    // 更新 currentStepId
    await updatePipeline(pipelineId, { currentStepId: step.id })

    // 派发下一个子 Agent
    const stepConfig = step.config as any
    window.dispatchEvent(new CustomEvent('worldsea:dispatch-sub-agent', {
      detail: {
        taskId: `pipeline-${pipelineId}-${step.id}-${Date.now()}`,
        type: 'creation',
        prompt: `/skill:creation-orchestrator 执行创作计划「${pipeline.name}」的步骤「${step.title}」。\n\n步骤类型：${step.type}\n步骤配置：${JSON.stringify(step.config)}\n\n请按照步骤配置完成创作任务。`,
        skillIds: stepConfig.skillIds ?? [],
        timeout: 120000,
        pipelineContext: {
          pipelineId,
          stepId: step.id,
        },
      },
    }))

    // 更新前端执行追踪
    currentStepIndex.value = nextIdx
    executeStep(step.id)
  }

  /** 重置所有步骤状态 */
  async function resetPipeline(pipelineId: string): Promise<void> {
    const pipeline = selectedPipeline.value
    if (!pipeline || pipeline.id !== pipelineId) return

    const steps = pipeline.steps.map(s => ({
      ...s,
      status: 'pending' as const,
      output: null,
    }))
    await updatePipeline(pipelineId, { steps, status: 'draft', currentStepId: null })
    log('Pipeline 已重置')
  }

  return {
    isExecuting,
    currentStepIndex,
    currentStep,
    progress,
    executionLog,
    executeStep,
    confirmReview,
    skipStep,
    markStepCompleted,
    markStepFailed,
    resetPipeline,
    findNextPendingStep,
    continueToNextStep,
  }
}
