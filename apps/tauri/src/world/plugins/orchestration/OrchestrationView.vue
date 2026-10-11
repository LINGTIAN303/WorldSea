<template>
  <div class="orchestration-view">
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
            @back="handleBack"
            @delete="handleDelete"
            @save-template="showSaveTemplate = true"
            @remove-step="handleRemoveStep"
            @update-step="handleUpdateStep"
            @reorder-steps="handleReorderSteps"
            @change-status="handleChangeStatus"
            @add-step="handleAddStep"
            @add-connection="handleAddConnection"
            @remove-connection="handleRemoveConnection"
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
import { ref } from 'vue'
import PipelineBoard from './views/PipelineBoard.vue'
import PipelineDetail from './views/PipelineDetail.vue'
import StepLibrary from './views/StepLibrary.vue'
import SaveAsTemplate from './components/SaveAsTemplate.vue'
import { usePipeline } from './composables/usePipeline'
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
} = usePipeline()

const { saveAsTemplate } = usePipelineTemplates()

const showSidebar = ref(true)
const showSaveTemplate = ref(false)

function handleSelect(id: string) {
  selectPipeline(id)
}

function handleBack() {
  selectPipeline(null)
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
</script>

<style scoped>
.orchestration-view {
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
  border-left: 1px solid var(--border, #e4e4e7);
  overflow: auto;
  flex-shrink: 0;
}
</style>
