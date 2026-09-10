<template>
  <div
    class="psn-node"
    :class="[
      `psn--${step.status}`,
      { 'psn--current': step.id === currentStepId, 'psn--editing': isEditingConfig, 'psn--edit-mode': editMode, 'psn--drag-over': isDragOver },
    ]"
    :draggable="editMode"
    @dragstart="onDragStart"
    @dragover.prevent="onDragOver"
    @dragleave="isDragOver = false"
    @drop="onDrop"
  >
    <div class="psn-indicator">
      <!-- 编辑模式下显示拖拽手柄 -->
      <span v-if="editMode" class="psn-grip" title="拖拽排序">⠿</span>
      <span v-else class="psn-num">{{ index + 1 }}</span>
      <span v-if="!isLast" class="psn-line"></span>
    </div>
    <div class="psn-content">
      <div class="psn-header">
        <span class="psn-icon"><StepTypeIcon :type="step.type" :size="18" /></span>

        <!-- 可编辑标题 -->
        <input
          v-if="isEditingTitle"
          ref="titleInput"
          v-model="editTitle"
          class="psn-title-input"
          @blur="commitTitle"
          @keydown.enter="commitTitle"
          @keydown.escape="cancelTitle"
        />
        <span v-else class="psn-title" :class="{ 'psn-title--editable': editMode }" @dblclick="startEditTitle">{{ step.title }}</span>

        <span class="psn-badge" :style="{ color: stepColor(step.type) }">{{ typeLabel(step.type) }}</span>
        <span class="psn-status" :class="`status--${step.status}`">{{ statusLabel(step.status) }}</span>

        <!-- 操作按钮：编辑模式下始终可见，非编辑模式下 hover 可见 -->
        <div class="psn-ops" :class="{ 'psn-ops--visible': editMode }" v-if="step.status === 'pending' || step.status === 'failed' || editMode">
          <button v-if="step.status === 'failed'" class="psn-op psn-op--retry" title="重试" @click.stop="$emit('retry', step.id)"><IconRefresh :size="14" /></button>
          <button class="psn-op" title="编辑配置" @click.stop="isEditingConfig = !isEditingConfig"><IconPencil :size="14" /></button>
          <button class="psn-op psn-op--danger" title="删除步骤" @click.stop="$emit('delete', step.id)"><IconTrash :size="14" /></button>
        </div>
      </div>

      <!-- user-review 步骤：等待用户确认 -->
      <div v-if="step.type === 'user-review' && step.status === 'running'" class="psn-body">
        <p class="psn-instruction">{{ (step.config as any).instruction }}</p>
        <div class="psn-actions">
          <button class="psn-btn psn-btn--primary" @click.stop="$emit('confirm', step.id)">确认</button>
          <button v-if="(step.config as any).skippable" class="psn-btn" @click.stop="$emit('skip', step.id)">跳过</button>
        </div>
      </div>

      <!-- running 状态：展示子 Agent 信息 -->
      <div v-if="step.status === 'running' && step.type !== 'user-review'" class="psn-body">
        <div v-if="runningAgent" class="psn-agent-info">
          <span class="psn-agent-icon">{{ runningAgent.icon }}</span>
          <span class="psn-agent-name">{{ runningAgent.name }} 执行中</span>
          <span v-if="runningAgent.duration" class="psn-agent-duration">
            {{ formatDuration(runningAgent.duration) }}
          </span>
        </div>
        <p v-else class="psn-agent-info">子 Agent 正在启动...</p>
      </div>

      <!-- 完成输出 -->
      <div v-if="step.output?.summary" class="psn-output">
        <p>{{ step.output.summary }}</p>
      </div>

      <!-- 配置编辑面板 -->
      <div v-if="isEditingConfig" class="psn-edit" @click.stop>
        <StepConfigEditor
          :step-type="step.type"
          :config="editConfig"
          @update:config="editConfig = $event"
        />
        <div class="psn-edit-actions">
          <button class="psn-btn psn-btn--primary" @click="commitEdit">保存</button>
          <button class="psn-btn" @click="cancelEdit">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import type { PipelineStep, StepType, StepStatus, StepConfig } from '../types'
import { STEP_TYPE_LABELS, STEP_TYPE_COLORS } from '../composables/useStepLibrary'
import { IconRefresh, IconPencil, IconTrash } from '@tabler/icons-vue'
import StepTypeIcon from './StepTypeIcon.vue'
import StepConfigEditor from './StepConfigEditor.vue'

const props = defineProps<{
  step: PipelineStep
  index: number
  isLast: boolean
  currentStepId?: string | null
  editMode: boolean
}>()

const emit = defineEmits<{
  select: [stepId: string]
  confirm: [stepId: string]
  skip: [stepId: string]
  delete: [stepId: string]
  retry: [stepId: string]
  'update-step': [stepId: string, changes: Partial<Pick<PipelineStep, 'title' | 'config'>>]
  'reorder': [fromIndex: number, toIndex: number]
}>()

/** 从全局 window 读取子 Agent 列表（避免 useOrchestrator 的 onBeforeUnmount 副作用） */
function getSubAgentsFromWindow(): any[] {
  const map = window.__worldsea_sub_agents as Map<string, any> | undefined
  return map ? Array.from(map.values()) : []
}

// 轮询刷新子 Agent 状态（轻量，仅在 running 时激活）
const subAgentTick = ref(0)
let tickTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  tickTimer = setInterval(() => {
    if (props.step.status === 'running') subAgentTick.value++
  }, 1000)
})
onBeforeUnmount(() => {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
})

// ─── 编辑状态 ──────────────────────────────────────────
const isEditingConfig = ref(false)
const isEditingTitle = ref(false)
const editTitle = ref('')
const editConfig = ref<StepConfig>({ ...props.step.config } as StepConfig)
const titleInput = ref<HTMLInputElement | null>(null)
const isDragOver = ref(false)

// 步骤 config 变化时同步到本地编辑副本
watch(() => props.step.config, (newCfg) => {
  if (!isEditingConfig.value) {
    editConfig.value = { ...newCfg } as StepConfig
  }
}, { deep: true })

/** 查找当前步骤对应的子 Agent */
const runningAgent = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void subAgentTick.value // 触发重算依赖
  if (props.step.status !== 'running') return null
  return getSubAgentsFromWindow().find(a =>
    a.id.includes(props.step.id) &&
    (a.status === 'running' || a.status === 'pending')
  )
})

// ─── 标题编辑 ─────────────────────────────────────────
function startEditTitle() {
  isEditingTitle.value = true
  editTitle.value = props.step.title
  nextTick(() => titleInput.value?.focus())
}

function commitTitle() {
  isEditingTitle.value = false
  const trimmed = editTitle.value.trim()
  if (trimmed && trimmed !== props.step.title) {
    emit('update-step', props.step.id, { title: trimmed })
  }
}

function cancelTitle() {
  isEditingTitle.value = false
}

// ─── 配置编辑 ─────────────────────────────────────────
function commitEdit() {
  isEditingConfig.value = false
  emit('update-step', props.step.id, { config: { ...editConfig.value } })
}

function cancelEdit() {
  isEditingConfig.value = false
  editConfig.value = { ...props.step.config } as StepConfig
}

// ─── 拖拽排序 ─────────────────────────────────────────
function onDragStart(e: DragEvent) {
  if (!props.editMode) return
  e.dataTransfer!.setData('text/plain', String(props.index))
  e.dataTransfer!.effectAllowed = 'move'
}

function onDragOver(e: DragEvent) {
  if (!props.editMode) return
  e.dataTransfer!.dropEffect = 'move'
  isDragOver.value = true
}

function onDrop(e: DragEvent) {
  isDragOver.value = false
  if (!props.editMode) return
  const fromStr = e.dataTransfer!.getData('text/plain')
  const fromIndex = parseInt(fromStr, 10)
  if (!isNaN(fromIndex) && fromIndex !== props.index) {
    emit('reorder', fromIndex, props.index)
  }
}

// ─── 工具函数 ─────────────────────────────────────────
function typeLabel(type: StepType): string {
  return STEP_TYPE_LABELS[type] || type
}

function stepColor(type: StepType): string {
  return STEP_TYPE_COLORS[type] || 'inherit'
}

function statusLabel(status: StepStatus): string {
  const map: Record<StepStatus, string> = {
    pending: '待执行', running: '执行中', completed: '已完成', failed: '失败', skipped: '已跳过',
  }
  return map[status] || status
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}min`
}
</script>

<style scoped>
.psn-node {
  display: flex; gap: 12px;
  transition: outline-color 0.15s, background 0.15s;
}
.psn--edit-mode { cursor: grab; }
.psn--edit-mode:active { cursor: grabbing; }
.psn--current {
  outline: 2px solid var(--primary, #4f46e5);
  outline-offset: 2px; border-radius: var(--radius-mid);
}
.psn--editing {
  outline: 2px solid var(--warning, #d97706);
  outline-offset: 2px; border-radius: var(--radius-mid);
}
.psn--drag-over {
  background: color-mix(in srgb, var(--primary, #4f46e5) 8%, transparent);
  outline: 2px dashed var(--primary, #4f46e5);
  outline-offset: 2px; border-radius: var(--radius-mid);
}

.psn-indicator { display: flex; flex-direction: column; align-items: center; width: 28px; flex-shrink: 0; }
.psn-num {
  width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-sm); font-weight: 600; border: 2px solid var(--border, #e4e4e7); background: var(--bg-secondary, #f4f4f5);
}
.psn-grip {
  width: 28px; height: 28px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-lg); color: var(--text-secondary, #6b7280); background: var(--bg-tertiary, #e4e4e7);
  cursor: grab; user-select: none;
}
.psn-grip:hover { color: var(--primary, #4f46e5); }
.psn--completed .psn-num { background: var(--success, #16a34a); color: var(--text-on-accent, #fff); border-color: var(--success, #16a34a); }
.psn--running .psn-num { background: var(--warning, #d97706); color: var(--text-on-accent, #fff); border-color: var(--warning, #d97706); }
.psn--failed .psn-num { background: var(--danger, #dc2626); color: var(--text-on-accent, #fff); border-color: var(--danger, #dc2626); }
.psn-line { width: 2px; flex: 1; min-height: 8px; background: var(--border, #e4e4e7); }
.psn--completed .psn-line { background: var(--success, #16a34a); }

.psn-content { flex: 1; padding: 4px 0 16px; }
.psn-header { display: flex; align-items: center; gap: 8px; }
.psn-icon { font-size: var(--fs-lg); }
.psn-title { font-size: var(--fs-base); font-weight: 500; }
.psn-title--editable { cursor: text; }
.psn-title--editable:hover { text-decoration: underline; text-underline-offset: 2px; }
.psn-title-input {
  font-size: var(--fs-base); font-weight: 500; border: none; border-bottom: 1px solid var(--primary, #4f46e5);
  background: transparent; color: inherit; outline: none; padding: 0; width: 160px;
}
.psn-badge { font-size: var(--fs-xs); opacity: 0.5; }
.psn-status { font-size: var(--fs-xs); margin-left: auto; }
.psn-ops { display: flex; gap: 2px; margin-left: 4px; opacity: 0; transition: opacity 0.15s; }
.psn-node:hover .psn-ops { opacity: 1; }
.psn-ops--visible { opacity: 1; }
.psn-op {
  background: none; border: none; cursor: pointer; font-size: var(--fs-md); padding: 2px 4px;
  border-radius: var(--radius-xs); transition: background 0.15s;
}
.psn-op:hover { background: var(--bg-tertiary, #e4e4e7); }
.psn-op--danger:hover { background: color-mix(in srgb, var(--danger, #dc2626) 20%, transparent); }
.psn-op--retry:hover { background: color-mix(in srgb, var(--warning, #d97706) 20%, transparent); }

.status--pending { color: var(--text-secondary, #6b7280); }
.status--running { color: var(--warning, #d97706); }
.status--completed { color: var(--success, #16a34a); }
.status--failed { color: var(--danger, #dc2626); }
.status--skipped { color: var(--text-secondary, #6b7280); font-style: italic; }

.psn-body { margin-top: 8px; padding: 10px; background: var(--bg-tertiary, #e4e4e7); border-radius: var(--radius-sm); }
.psn-instruction { margin: 0 0 8px; font-size: var(--fs-md); line-height: 1.5; }
.psn-actions { display: flex; gap: 6px; }

.psn-btn {
  padding: 5px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border, #e4e4e7);
  background: var(--bg-secondary, #f4f4f5); color: var(--text-primary, #18181b);
  cursor: pointer; font-size: var(--fs-sm);
}
.psn-btn--primary { background: var(--primary, #4f46e5); color: var(--text-on-primary, #fff); border-color: transparent; }

.psn-agent-info {
  display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm);
}
.psn-agent-icon { font-size: var(--fs-base); }
.psn-agent-name { color: var(--warning, #d97706); font-weight: 500; }
.psn-agent-duration { font-size: var(--fs-xs); opacity: 0.5; margin-left: auto; }

.psn-output { margin-top: 8px; padding: 8px 10px; background: var(--bg-tertiary, #e4e4e7); border-radius: var(--radius-sm); font-size: var(--fs-sm); opacity: 0.8; }
.psn-output p { margin: 0; }

.psn-edit {
  margin-top: 8px; padding: 12px; background: var(--bg-tertiary, #e4e4e7); border-radius: var(--radius-sm);
  border: 1px solid var(--border, #e4e4e7);
}
.psn-edit-actions { display: flex; gap: 6px; margin-top: 8px; }
</style>
