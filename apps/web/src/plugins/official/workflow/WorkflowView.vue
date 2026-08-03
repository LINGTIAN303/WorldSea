<template>
  <div class="workflow-view">
    <!-- 列表视图 -->
    <PipelineBoard
      v-if="!selectedPipeline"
      @select="handleSelect"
    />

    <!-- 详情视图 -->
    <template v-else>
      <div class="wv-layout">
        <div class="wv-main">
          <PipelineDetail
            :pipeline="selectedPipeline"
            :current-step="currentStep"
            :progress="progress"
            :execution-log="executionLog"
            @back="handleBack"
            @run-agent="handleRunAgent"
            @confirm-step="confirmReview"
            @skip-step="skipStep"
            @delete="handleDelete"
            @save-template="showSaveTemplate = true"
            @send-prompt="handleSendPrompt"
            @remove-step="handleRemoveStep"
            @update-step="handleUpdateStep"
            @reorder-steps="handleReorderSteps"
            @change-status="handleChangeStatus"
            @add-step="handleAddStep"
            @add-connection="handleAddConnection"
            @remove-connection="handleRemoveConnection"
            @retry-step="handleRetryStep"
          />
        </div>
        <aside class="wv-sidebar" v-if="showSidebar">
          <StepLibrary @add-step="handleAddStep" />
        </aside>
      </div>
    </template>

    <!-- 保存为模板对话框 -->
    <SaveAsTemplate
      v-if="showSaveTemplate && selectedPipeline"
      :pipeline="selectedPipeline"
      @close="showSaveTemplate = false"
      @save="handleSaveTemplate"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import PipelineBoard from './views/PipelineBoard.vue'
import PipelineDetail from './views/PipelineDetail.vue'
import StepLibrary from './views/StepLibrary.vue'
import SaveAsTemplate from './components/SaveAsTemplate.vue'
import { usePipeline } from './composables/usePipeline'
import { usePipelineExecution } from './composables/usePipelineExecution'
import { usePipelineTemplates } from './composables/usePipelineTemplates'
import type { StepLibraryItem, PipelineStep, PipelineStatus, StepConnection } from './types'

const {
  selectedPipeline,
  selectPipeline,
  addStep,
  removeStep,
  updateStep,
  reorderSteps,
  updatePipeline,
  deletePipeline,
  addConnection,
  removeConnection,
  updateStepStatus,
} = usePipeline()

const {
  currentStep,
  progress,
  executionLog,
  executeStep,
  confirmReview,
  skipStep,
  findNextPendingStep,
  continueToNextStep,
} = usePipelineExecution()

const { saveAsTemplate } = usePipelineTemplates()

const showSidebar = ref(true)
const showSaveTemplate = ref(false)

function handleSelect(id: string) {
  selectPipeline(id)
}

function handleBack() {
  selectPipeline(null)
}

/** 「交给 Agent 执行」按钮 — 通过 sub-agent 通道派发，带 pipelineContext 实现自动状态回传 */
function handleRunAgent() {
  const pipeline = selectedPipeline.value
  if (!pipeline) return

  const nextIdx = findNextPendingStep(pipeline)
  if (nextIdx < 0) return

  const step = pipeline.steps[nextIdx]

  // 先在前端日志中记录
  executeStep(step.id)

  // 更新 Pipeline 状态为 running，设置 currentStepId
  updatePipeline(pipeline.id, { status: 'running', currentStepId: step.id })

  // 通过 sub-agent 派发，携带 pipelineContext，完成后 autoUpdatePipelineStep 自动回写
  window.dispatchEvent(new CustomEvent('worldsmith:dispatch-sub-agent', {
    detail: {
      taskId: `pipeline-${pipeline.id}-${step.id}-${Date.now()}`,
      type: 'creation',
      prompt: `/skill:creation-orchestrator 执行创作计划「${pipeline.name}」的步骤「${step.title}」。\n\n步骤类型：${step.type}\n步骤配置：${JSON.stringify(step.config)}\n\n请按照步骤配置完成创作任务。`,
      skillIds: (step.config as any).skillIds ?? [],
      timeout: 120000,
      pipelineContext: {
        pipelineId: pipeline.id,
        stepId: step.id,
      },
    },
  }))
}

/** 聊天框发送指令 — 已由 PipelineChat 内部处理 plugin-action，这里只做日志 */
function handleSendPrompt(_prompt: string) {
  // PipelineChat 已经通过 plugin-action 发送给 Agent
}

async function handleAddStep(item: StepLibraryItem) {
  const pipeline = selectedPipeline.value
  if (!pipeline) return
  await addStep(pipeline.id, {
    type: item.type,
    title: item.label,
    config: { ...item.defaultConfig },
  })
}

async function handleRemoveStep(stepId: string) {
  const pipeline = selectedPipeline.value
  if (!pipeline) return
  await removeStep(pipeline.id, stepId)
}

async function handleUpdateStep(stepId: string, changes: Partial<Pick<PipelineStep, 'title' | 'config'>>) {
  const pipeline = selectedPipeline.value
  if (!pipeline) return
  await updateStep(pipeline.id, stepId, changes)
}

async function handleReorderSteps(fromIndex: number, toIndex: number) {
  const pipeline = selectedPipeline.value
  if (!pipeline) return
  // 重排：取出 fromIndex 的步骤，插入到 toIndex 位置
  const ids = pipeline.steps.map(s => s.id)
  const [moved] = ids.splice(fromIndex, 1)
  ids.splice(toIndex, 0, moved)
  await reorderSteps(pipeline.id, ids)
}

async function handleChangeStatus(status: PipelineStatus) {
  const pipeline = selectedPipeline.value
  if (!pipeline) return
  await updatePipeline(pipeline.id, { status })
}

async function handleDelete() {
  const pipeline = selectedPipeline.value
  if (!pipeline) return
  await deletePipeline(pipeline.id)
  selectPipeline(null)
}

async function handleAddConnection(connection: StepConnection) {
  const pipeline = selectedPipeline.value
  if (!pipeline) return
  await addConnection(pipeline.id, connection)
}

async function handleRemoveConnection(from: string, to: string) {
  const pipeline = selectedPipeline.value
  if (!pipeline) return
  await removeConnection(pipeline.id, from, to)
}

/** 重试失败步骤：重置为 pending，然后通过 sub-agent 重新执行 */
async function handleRetryStep(stepId: string) {
  const pipeline = selectedPipeline.value
  if (!pipeline) return

  const step = pipeline.steps.find(s => s.id === stepId)
  if (!step || step.status !== 'failed') return

  // 先重置步骤状态为 pending
  await updateStepStatus(pipeline.id, stepId, 'pending', null)

  // 更新 Pipeline 状态为 running
  await updatePipeline(pipeline.id, { status: 'running', currentStepId: stepId })

  // 等待状态更新完成后再派发子 Agent
  const stepConfig = step.config as any
  window.dispatchEvent(new CustomEvent('worldsmith:dispatch-sub-agent', {
    detail: {
      taskId: `pipeline-${pipeline.id}-retry-${stepId}-${Date.now()}`,
      type: 'creation',
      prompt: `/skill:creation-orchestrator 重新执行创作计划「${pipeline.name}」的步骤「${step.title}」。\n\n步骤类型：${step.type}\n步骤配置：${JSON.stringify(step.config)}\n\n请按照步骤配置完成创作任务。`,
      skillIds: stepConfig.skillIds ?? [],
      timeout: 120000,
      pipelineContext: {
        pipelineId: pipeline.id,
        stepId,
      },
    },
  }))

  executeStep(stepId)
}

function handleSaveTemplate(params: {
  name: string
  description?: string
  icon?: string
  tags?: string[]
  steps: any[]
  connections: any[]
}) {
  saveAsTemplate(params as any)
  showSaveTemplate.value = false
}

// ─── 监听 Pipeline 步骤完成事件，自动继续执行 ────────────────────────
function onPipelineStepCompleted(e: Event) {
  const { pipelineId, stepId } = (e as CustomEvent).detail
  continueToNextStep(pipelineId, stepId)
}

onMounted(() => {
  window.addEventListener('worldsmith:pipeline-step-completed', onPipelineStepCompleted as EventListener)
})

onBeforeUnmount(() => {
  window.removeEventListener('worldsmith:pipeline-step-completed', onPipelineStepCompleted as EventListener)
})
</script>

<style scoped>
.workflow-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.wv-layout {
  display: flex;
  height: 100%;
}

.wv-main {
  flex: 1;
  overflow: auto;
}

.wv-sidebar {
  width: 240px;
  border-left: 1px solid var(--border, #30363d);
  overflow: auto;
  flex-shrink: 0;
}
</style>
