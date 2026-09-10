<template>
  <div v-if="pipeline" class="pd-view" :class="{ 'pd-view--editing': editing, 'pd-view--with-sidebar': sidebarVisible }">
    <div class="pd-main">
      <PipelineToolbar
      :pipeline="pipeline"
      :editing="editing"
      :show-sidebar-toggle="true"
      :sidebar-visible="sidebarVisible"
      @back="$emit('back')"
      @run-agent="$emit('run-agent')"
      @run-direct="onRunDirect"
      @save-template="$emit('save-template')"
      @delete="$emit('delete')"
      @change-status="handleChangeStatus"
      @toggle-edit="editing = $event"
      @toggle-sidebar="sidebarVisible = !sidebarVisible"
    />

      <ExecutionPanel
        :current-step="currentStep"
        :progress="progress"
        :execution-log="executionLog"
        :engine-state="engineState"
        @cancel-engine="onCancelEngine"
      />

      <!-- 编辑模式提示条 -->
      <div v-if="editing" class="pd-edit-banner">
        <span><IconPencil :size="13" /> 编辑模式 — 双击标题可重命名，拖拽手柄可排序，点击图标编辑配置</span>
      </div>

      <!-- 步骤列表 -->
      <div class="pd-steps">
        <PipelineStepNode
          v-for="(step, idx) in pipeline.steps"
          :key="step.id"
          :step="step"
          :index="idx"
          :is-last="idx === pipeline.steps.length - 1"
          :current-step-id="currentStep?.id"
          :edit-mode="editing"
          @select="(id: string) => $emit('select-step', id)"
          @confirm="(id: string) => $emit('confirm-step', id)"
          @skip="(id: string) => $emit('skip-step', id)"
          @delete="(id: string) => $emit('remove-step', id)"
          @retry="(id: string) => $emit('retry-step', id)"
          @update-step="(id, changes) => $emit('update-step', id, changes)"
          @reorder="(from, to) => $emit('reorder-steps', from, to)"
        />
      </div>

      <!-- 连接管理（编辑模式下显示） -->
      <div v-if="editing && pipeline.steps.length >= 2" class="pd-connections">
        <div class="pd-connections__header">
          <h4><IconLink :size="14" /> 步骤连接</h4>
          <button class="pd-connections__add" @click="showAddConnection = true">+ 添加连接</button>
        </div>

        <!-- 现有连接列表 -->
        <div v-if="pipeline.connections.length" class="pd-connections__list">
          <div v-for="conn in pipeline.connections" :key="`${conn.from}-${conn.to}`" class="pd-conn">
            <span class="pd-conn__from">{{ stepTitle(conn.from) }}</span>
            <span class="pd-conn__arrow">→</span>
            <span class="pd-conn__to">{{ stepTitle(conn.to) }}</span>
            <span v-if="conn.dataMapping?.length" class="pd-conn__mapping">
              {{ conn.dataMapping.map(m => `${m.fromField}→${m.toField}`).join(', ') }}
            </span>
            <button class="pd-conn__delete" title="删除连接" @click="$emit('remove-connection', conn.from, conn.to)"><IconX :size="13" /></button>
          </div>
        </div>
        <p v-else class="pd-connections__empty">暂无连接，步骤将按顺序依次执行</p>

        <!-- 添加连接对话框 -->
        <div v-if="showAddConnection" class="pd-conn-form">
          <select v-model="newConnFrom" class="pd-conn-select">
            <option value="">源步骤</option>
            <option v-for="s in pipeline.steps" :key="s.id" :value="s.id">{{ s.title }}</option>
          </select>
          <span class="pd-conn-arrow">→</span>
          <select v-model="newConnTo" class="pd-conn-select">
            <option value="">目标步骤</option>
            <option v-for="s in pipeline.steps" :key="s.id" :value="s.id" :disabled="s.id === newConnFrom">{{ s.title }}</option>
          </select>
          <button class="pd-conn-btn" :disabled="!newConnFrom || !newConnTo || newConnFrom === newConnTo" @click="handleAddConnection">添加</button>
          <button class="pd-conn-btn" @click="showAddConnection = false; newConnFrom = ''; newConnTo = ''">取消</button>
        </div>
      </div>

      <!-- 空步骤：引导式添加入口 -->
      <div v-if="pipeline.steps.length === 0" class="pd-empty">
        <div class="pd-empty__hero">
          <div class="pd-empty__icon"><TemplateIcon name="clipboard" :size="30" /></div>
          <h3>开始编排你的创作计划</h3>
          <p class="pd-empty__desc">为「{{ pipeline.name }}」添加步骤，定义创作流程</p>
        </div>

        <!-- Agent 设计入口 -->
        <div class="pd-empty__agent" role="button" tabindex="0" @click="$emit('send-prompt', `/skill:creation-orchestrator 请为「${pipeline.name}」设计创作步骤。${pipeline.description ? '目标：' + pipeline.description : ''}`)" @keydown.enter.prevent="$emit('send-prompt', `/skill:creation-orchestrator 请为「${pipeline.name}」设计创作步骤。${pipeline.description ? '目标：' + pipeline.description : ''}`)" @keydown.space.prevent="$emit('send-prompt', `/skill:creation-orchestrator 请为「${pipeline.name}」设计创作步骤。${pipeline.description ? '目标：' + pipeline.description : ''}`)">
          <span class="pd-empty__agent-icon"><TemplateIcon name="sparkles" :size="20" /></span>
          <div class="pd-empty__agent-info">
            <span class="pd-empty__agent-title">让 Agent 帮你设计</span>
            <span class="pd-empty__agent-desc">描述你的创作目标，Agent 自动生成步骤</span>
          </div>
          <span class="pd-empty__arrow">→</span>
        </div>

        <!-- 手动添加步骤 -->
        <div class="pd-empty__manual">
          <h4>或手动添加步骤</h4>
          <div class="pd-empty__steps">
            <div
              v-for="item in stepLibraryItems"
              :key="item.type"
              class="pd-step-card"
              role="button"
              tabindex="0"
              @click="$emit('add-step', item)"
              @keydown.enter.prevent="$emit('add-step', item)"
              @keydown.space.prevent="$emit('add-step', item)"
            >
              <span class="pd-step-card__icon"><StepTypeIcon :type="item.type" :size="18" /></span>
              <div class="pd-step-card__info">
                <span class="pd-step-card__label">{{ item.label }}</span>
                <span class="pd-step-card__desc">{{ item.description }}</span>
              </div>
              <span class="pd-step-card__add">+</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Agent 聊天入口 -->
      <PipelineChat
        :pipeline="pipeline"
        @send-prompt="(prompt: string) => $emit('send-prompt', prompt)"
      />
    </div>

    <!-- 运行历史侧栏 -->
    <aside v-if="sidebarVisible" class="pd-sidebar">
      <RunHistorySidebar ref="runHistoryRef" @select-run="onSelectRun" />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { IconPencil, IconLink, IconX } from '@tabler/icons-vue'
import type { CreationPipeline, PipelineStep, PipelineStatus, StepLibraryItem, StepConnection } from '../types'
import PipelineToolbar from '../components/PipelineToolbar.vue'
import PipelineStepNode from '../components/PipelineStepNode.vue'
import ExecutionPanel from '../components/ExecutionPanel.vue'
import PipelineChat from '../components/PipelineChat.vue'
import RunHistorySidebar from '../components/RunHistorySidebar.vue'
import StepTypeIcon from '../components/StepTypeIcon.vue'
import TemplateIcon from '../components/TemplateIcon.vue'
import { useStepLibrary } from '../composables/useStepLibrary'
import { useWorkflowEngineRun } from '../composables/useWorkflowEngineRun'

const props = defineProps<{
  pipeline: CreationPipeline | null
  currentStep: PipelineStep | null
  progress: number
  executionLog: string[]
}>()

const emit = defineEmits<{
  back: []
  'run-agent': []
  'save-template': []
  delete: []
  'select-step': [stepId: string]
  'confirm-step': [stepId: string]
  'skip-step': [stepId: string]
  'remove-step': [stepId: string]
  'retry-step': [stepId: string]
  'update-step': [stepId: string, changes: Partial<Pick<PipelineStep, 'title' | 'config'>>]
  'reorder-steps': [fromIndex: number, toIndex: number]
  'send-prompt': [prompt: string]
  'change-status': [status: PipelineStatus]
  'add-step': [item: StepLibraryItem]
  'add-connection': [connection: StepConnection]
  'remove-connection': [from: string, to: string]
}>()

const editing = ref(false)
const sidebarVisible = ref(false)
const runHistoryRef = ref<InstanceType<typeof RunHistorySidebar> | null>(null)

// 直接 Dispatch 兜底通道（P0-1-B1）
const { state: engineRunState, start: startEngineRun, cancel: cancelEngineRun } = useWorkflowEngineRun()

/** 仅在引擎通道非 idle 时显示，避免占用 ExecutionPanel 空间 */
const engineState = computed(() => {
  if (engineRunState.value.status === 'idle') return null
  // readonly(state) 返回 DeepReadonly，需浅拷贝解包以兼容 ExecutionPanel 的可变 prop 类型
  const s = engineRunState.value
  return { ...s, log: [...s.log] }
})

// 步骤库数据（空状态展示用）
const { library: stepLibraryItems } = useStepLibrary()

// 连接管理状态
const showAddConnection = ref(false)
const newConnFrom = ref('')
const newConnTo = ref('')

function handleChangeStatus(status: PipelineStatus) {
  emit('change-status', status)
}

/** 运行历史选中 run 回调（预留：未来可在此加载节点日志） */
function onSelectRun(_runId: string) {
  // P0-1-A2：仅展示列表，节点日志查看留待后续
}

/**
 * 直接执行（P0-1-B1 兜底通道）
 *
 * 当前实现：用 pipeline.id 直接调 workflow_run。
 * 若 Rust 端找不到对应 workflow，错误会显示在 Engine 通道，
 * 后续可在 start() 前先 workflowCreate/Update 做映射（留待 P0-1-C）。
 */
async function onRunDirect() {
  if (!props.pipeline) return
  await startEngineRun({
    id: props.pipeline.id,
    params: {
      // 把 pipeline 基础信息作为 params 传给引擎，便于调试
      name: props.pipeline.name,
      description: props.pipeline.description,
      stepCount: props.pipeline.steps.length,
    },
    triggeredBy: 'manual',
  })
  // 运行结束后刷新侧栏
  runHistoryRef.value?.loadRuns()
}

/** 取消引擎运行 */
function onCancelEngine() {
  void cancelEngineRun()
}

/** 获取步骤标题（用于连接展示） */
function stepTitle(stepId: string): string {
  return props.pipeline?.steps.find(s => s.id === stepId)?.title ?? stepId.slice(0, 8)
}

/** 添加连接 */
function handleAddConnection() {
  if (!newConnFrom.value || !newConnTo.value || newConnFrom.value === newConnTo.value) return
  emit('add-connection', { from: newConnFrom.value, to: newConnTo.value })
  showAddConnection.value = false
  newConnFrom.value = ''
  newConnTo.value = ''
}
</script>

<style scoped>
/* 视图根：默认纵向 flex；侧栏打开时切换为横向 flex */
.pd-view {
  display: flex; flex-direction: column;
  height: 100%; padding: 16px; gap: 12px; overflow: hidden;
}
.pd-view--editing {
  background: color-mix(in srgb, var(--warning, #d97706) 3%, var(--bg-primary, #ffffff));
}
.pd-view--with-sidebar { flex-direction: row; }

/* 主区域：侧栏打开时占据剩余空间，并自身滚动 */
.pd-main {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 12px; overflow: auto;
}

/* 侧栏：固定宽度，纵向滚动，与主区域之间用 border 分隔 */
.pd-sidebar {
  width: 320px; flex-shrink: 0;
  padding-left: 12px;
  border-left: 1px solid var(--border, #e4e4e7);
  overflow: auto;
}

.pd-edit-banner {
  padding: 6px 12px; border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--warning, #d97706) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning, #d97706) 30%, transparent);
  font-size: var(--fs-sm); color: var(--warning, #d97706); flex-shrink: 0;
}

.pd-steps { display: flex; flex-direction: column; gap: 0; flex: 1; }

.pd-empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 32px 16px; gap: 20px; flex: 1; overflow: auto;
}
.pd-empty__hero {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  text-align: center;
}
.pd-empty__icon { font-size: 40px; }
.pd-empty__hero h3 { margin: 0; font-size: var(--fs-lg); font-weight: 600; }
.pd-empty__desc { margin: 0; font-size: var(--fs-md); opacity: 0.6; }

.pd-empty__agent {
  display: flex; align-items: center; gap: 12px; width: 100%; max-width: 480px;
  padding: 14px 16px; border-radius: var(--radius-md); cursor: pointer;
  background: color-mix(in srgb, var(--primary, #4f46e5) 10%, var(--bg-secondary, #f4f4f5));
  border: 1px solid color-mix(in srgb, var(--primary, #4f46e5) 30%, transparent);
  transition: background 0.15s, border-color 0.15s;
}
.pd-empty__agent:hover {
  background: color-mix(in srgb, var(--primary, #4f46e5) 18%, var(--bg-secondary, #f4f4f5));
  border-color: var(--primary, #4f46e5);
}
.pd-empty__agent-icon { font-size: 28px; flex-shrink: 0; }
.pd-empty__agent-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.pd-empty__agent-title { font-size: var(--fs-base); font-weight: 600; }
.pd-empty__agent-desc { font-size: var(--fs-sm); opacity: 0.6; }
.pd-empty__arrow { font-size: 18px; color: var(--primary, #4f46e5); flex-shrink: 0; }

.pd-empty__manual {
  width: 100%; max-width: 480px;
}
.pd-empty__manual h4 {
  margin: 0 0 10px; font-size: var(--fs-md); font-weight: 500; opacity: 0.5;
  text-align: center;
}
.pd-empty__steps {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;
}
.pd-step-card {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: var(--radius-mid); cursor: pointer;
  background: var(--bg-secondary, #f4f4f5);
  border: 1px solid var(--border, #e4e4e7);
  transition: border-color 0.15s, background 0.15s;
}
.pd-step-card:hover {
  border-color: var(--primary, #4f46e5);
  background: var(--bg-tertiary, #e4e4e7);
}
.pd-step-card__icon { font-size: 18px; flex-shrink: 0; }
.pd-step-card__info { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.pd-step-card__label { font-size: var(--fs-sm); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pd-step-card__desc { font-size: var(--fs-2xs); opacity: 0.5; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pd-step-card__add {
  width: 22px; height: 22px; border-radius: 50%; display: flex;
  align-items: center; justify-content: center; flex-shrink: 0;
  background: var(--bg-tertiary, #e4e4e7); font-size: var(--fs-base); font-weight: 500;
  color: var(--primary, #4f46e5);
}

/* 连接管理 */
.pd-connections {
  padding: 12px; background: var(--bg-secondary, #f4f4f5); border-radius: var(--radius-mid);
  border: 1px solid var(--border, #e4e4e7);
}
.pd-connections__header {
  display: flex; align-items: center; justify-content: space-between;
}
.pd-connections__header h4 { margin: 0; font-size: var(--fs-md); font-weight: 500; }
.pd-connections__add {
  padding: 3px 10px; border-radius: var(--radius-sm); border: 1px dashed var(--border, #e4e4e7);
  background: none; color: var(--primary, #4f46e5); font-size: var(--fs-xs); cursor: pointer;
}
.pd-connections__add:hover { border-color: var(--primary, #4f46e5); }
.pd-connections__empty { font-size: var(--fs-sm); opacity: 0.5; margin: 8px 0 0; }
.pd-connections__list { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.pd-conn {
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  background: var(--bg-tertiary, #e4e4e7); border-radius: var(--radius-sm); font-size: var(--fs-sm);
}
.pd-conn__from, .pd-conn__to { font-weight: 500; }
.pd-conn__arrow { color: var(--primary, #4f46e5); }
.pd-conn__mapping { font-size: var(--fs-xs); opacity: 0.5; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-conn__delete {
  background: none; border: none; color: var(--danger, #dc2626); cursor: pointer;
  font-size: var(--fs-sm); padding: 2px 4px; opacity: 0.6;
}
.pd-conn__delete:hover { opacity: 1; }
.pd-conn-form {
  margin-top: 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.pd-conn-select {
  padding: 4px 8px; border-radius: 5px; border: 1px solid var(--border, #e4e4e7);
  background: var(--bg-primary, #ffffff); color: var(--text-primary, #18181b); font-size: var(--fs-sm);
}
.pd-conn-select:focus { border-color: var(--primary, #4f46e5); outline: none; }
.pd-conn-arrow { color: var(--primary, #4f46e5); font-size: var(--fs-base); }
.pd-conn-btn {
  padding: 4px 10px; border-radius: 5px; border: 1px solid var(--border, #e4e4e7);
  background: var(--bg-secondary, #f4f4f5); color: var(--text-primary, #18181b);
  font-size: var(--fs-xs); cursor: pointer;
}
.pd-conn-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
