<template>
  <div class="pipeline-board">
    <!-- 顶部工具栏 -->
    <div class="pb-toolbar">
      <h2 class="pb-title">
        <WsIcon name="lightning" size="sm" />
        创作编排
      </h2>
      <div class="pb-actions">
        <button class="pb-btn pb-btn--primary" @click="showCreateDialog = true">
          + 新建计划
        </button>
        <button class="pb-btn" @click="showTemplateDialog = true">
          📋 从模板创建
        </button>
      </div>
    </div>

    <!-- Pipeline 列表 -->
    <div v-if="loading" class="pb-loading">
      <TuiSpinner />
    </div>

    <div v-else-if="pipelineList.length === 0" class="pb-empty">
      <div class="pb-empty__icon">📋</div>
      <h3>还没有创作计划</h3>
      <p>创建一个创作计划，将复杂的创作目标拆解为有序步骤</p>
      <button class="pb-btn pb-btn--primary" @click="showCreateDialog = true">
        创建第一个计划
      </button>
    </div>

    <div v-else class="pb-grid">
      <div
        v-for="p in pipelineList"
        :key="p.id"
        class="pb-card"
        :class="{ 'pb-card--active': selectedId === p.id }"
        @click="selectPipeline(p.id)"
      >
        <div class="pb-card__header">
          <span class="pb-card__status" :class="`status--${p.status}`">{{ statusLabel(p.status) }}</span>
          <span class="pb-card__progress" v-if="p.stepCount > 0">
            {{ p.completedSteps }}/{{ p.stepCount }}
          </span>
        </div>
        <h3 class="pb-card__title">{{ p.name }}</h3>
        <p class="pb-card__desc" v-if="p.description">{{ p.description }}</p>
        <div class="pb-card__footer">
          <div class="pb-card__tags" v-if="p.tags.length">
            <span v-for="tag in p.tags.slice(0, 3)" :key="tag" class="pb-tag">{{ tag }}</span>
          </div>
          <span class="pb-card__time">{{ formatTime(p.updatedAt) }}</span>
        </div>
        <button class="pb-card__enter" @click.stop="onSelect(p.id)">
          进入编排 →
        </button>
      </div>
    </div>

    <!-- 新建对话框 -->
    <div v-if="showCreateDialog" class="pb-overlay" @click.self="showCreateDialog = false">
      <div class="pb-dialog">
        <h3>新建创作计划</h3>
        <div class="pb-field">
          <label>名称</label>
          <input v-model="newName" class="pb-input" placeholder="例如：中世纪王国设计" />
        </div>
        <div class="pb-field">
          <label>描述</label>
          <textarea v-model="newDesc" class="pb-input pb-textarea" placeholder="简要描述创作目标..." />
        </div>
        <div class="pb-dialog__actions">
          <button class="pb-btn" @click="showCreateDialog = false">取消</button>
          <button class="pb-btn pb-btn--primary" :disabled="!newName.trim()" @click="handleCreate">创建</button>
        </div>
      </div>
    </div>

    <!-- 模板选择对话框 -->
    <div v-if="showTemplateDialog" class="pb-overlay" @click.self="showTemplateDialog = false">
      <div class="pb-dialog pb-dialog--wide">
        <h3>从模板创建</h3>
        <div class="pb-tpl-grid">
          <div
            v-for="tpl in allTemplates"
            :key="tpl.id"
            class="pb-tpl-card"
            @click="handleApplyTemplate(tpl.id)"
          >
            <div class="pb-tpl-card__icon">{{ tpl.icon }}</div>
            <h4>{{ tpl.name }}</h4>
            <p>{{ tpl.description }}</p>
            <span class="pb-tpl-card__steps">{{ tpl.steps.length }} 个步骤</span>
          </div>
        </div>
        <div class="pb-dialog__actions">
          <button class="pb-btn" @click="showTemplateDialog = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import TuiSpinner from '@/components/ui/TuiSpinner.vue'
import { usePipeline } from '../composables/usePipeline'
import { usePipelineTemplates } from '../composables/usePipelineTemplates'
import type { PipelineStatus } from '../types'

const emit = defineEmits<{
  select: [id: string]
}>()

const {
  selectedId,
  pipelineList,
  loadPipelines,
  createPipeline,
  selectPipeline,
} = usePipeline()

const { allTemplates, applyTemplate } = usePipelineTemplates()

const loading = ref(true)
const showCreateDialog = ref(false)
const showTemplateDialog = ref(false)
const newName = ref('')
const newDesc = ref('')

onMounted(async () => {
  await loadPipelines()
  loading.value = false
})

function statusLabel(s: PipelineStatus): string {
  const map: Record<PipelineStatus, string> = {
    draft: '草稿', ready: '就绪', running: '执行中', paused: '已暂停', completed: '已完成', failed: '失败',
  }
  return map[s] || s
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

async function handleCreate() {
  if (!newName.value.trim()) return
  const pipeline = await createPipeline({ name: newName.value.trim(), description: newDesc.value.trim() })
  newName.value = ''
  newDesc.value = ''
  showCreateDialog.value = false
  // 创建后自动跳转到详情
  selectPipeline(pipeline.id)
  emit('select', pipeline.id)
}

async function handleApplyTemplate(templateId: string) {
  const pipelineId = await applyTemplate(templateId)
  showTemplateDialog.value = false
  // 模板创建后自动跳转到详情
  if (pipelineId) {
    selectPipeline(pipelineId)
    emit('select', pipelineId)
  }
}

function onSelect(id: string) {
  selectPipeline(id)
  emit('select', id)
}
</script>

<style scoped>
.pipeline-board {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  gap: 16px;
  overflow: auto;
}

.pb-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.pb-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.pb-actions { display: flex; gap: 8px; }

.pb-btn {
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border, #30363d);
  background: var(--bg-secondary, #161b22);
  color: var(--text-primary, #e6edf3);
  cursor: pointer;
  font-size: var(--fs-md);
  transition: background 0.15s;
}
.pb-btn:hover { background: var(--bg-tertiary, #21262d); }
.pb-btn--primary { background: var(--primary, #58a6ff); color: var(--text-on-primary, #fff); border-color: transparent; }
.pb-btn--primary:hover { opacity: 0.9; }
.pb-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.pb-loading { display: flex; justify-content: center; padding: 48px; }

.pb-empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; flex: 1; gap: 8px; opacity: 0.7;
}
.pb-empty__icon { font-size: 48px; }
.pb-empty h3 { margin: 0; font-size: var(--fs-lg); }
.pb-empty p { margin: 0; font-size: var(--fs-md); }

.pb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.pb-card {
  padding: 14px;
  border-radius: var(--radius-mid);
  border: 1px solid var(--border, #30363d);
  background: var(--bg-secondary, #161b22);
  cursor: pointer;
  transition: border-color 0.15s;
}
.pb-card:hover { border-color: var(--primary, #58a6ff); }
.pb-card--active { border-color: var(--primary, #58a6ff); box-shadow: 0 0 0 1px var(--primary, #58a6ff); }

.pb-card__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.pb-card__status { font-size: var(--fs-xs); padding: 2px 8px; border-radius: var(--radius-md); font-weight: 500; }
.status--draft { background: color-mix(in srgb, var(--text-secondary, #8b949e) 20%, transparent); color: var(--text-secondary, #8b949e); }
.status--ready { background: color-mix(in srgb, var(--primary, #58a6ff) 20%, transparent); color: var(--primary, #58a6ff); }
.status--running { background: color-mix(in srgb, var(--warning, #d29922) 20%, transparent); color: var(--warning, #d29922); }
.status--completed { background: color-mix(in srgb, var(--success, #3fb950) 20%, transparent); color: var(--success, #3fb950); }
.status--failed { background: color-mix(in srgb, var(--danger, #f85149) 20%, transparent); color: var(--danger, #f85149); }
.pb-card__progress { font-size: var(--fs-sm); opacity: 0.6; }
.pb-card__title { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
.pb-card__desc { margin: 0; font-size: var(--fs-sm); opacity: 0.6; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pb-card__footer { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
.pb-card__tags { display: flex; gap: 4px; }
.pb-tag { font-size: var(--fs-xs); padding: 1px 6px; border-radius: var(--radius-xs); background: var(--bg-tertiary, #21262d); opacity: 0.7; }
.pb-card__time { font-size: var(--fs-xs); opacity: 0.4; }

.pb-card__enter {
  display: block; width: 100%; margin-top: 10px; padding: 6px 0;
  border-radius: var(--radius-sm); border: 1px solid color-mix(in srgb, var(--primary, #58a6ff) 40%, transparent);
  background: color-mix(in srgb, var(--primary, #58a6ff) 8%, transparent);
  color: var(--primary, #58a6ff); font-size: var(--fs-sm); font-weight: 500;
  cursor: pointer; transition: background 0.15s, border-color 0.15s;
}
.pb-card__enter:hover {
  background: color-mix(in srgb, var(--primary, #58a6ff) 18%, transparent);
  border-color: var(--primary, #58a6ff);
}

.pb-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.pb-dialog {
  background: var(--bg-primary, #0d1117); border: 1px solid var(--border, #30363d);
  border-radius: var(--radius-2xl); padding: 24px; min-width: 360px; max-width: 500px;
}
.pb-dialog--wide { max-width: 640px; }
.pb-dialog h3 { margin: 0 0 16px; font-size: var(--fs-lg); }
.pb-field { margin-bottom: 12px; }
.pb-field label { display: block; font-size: var(--fs-md); margin-bottom: 4px; opacity: 0.7; }
.pb-input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--border, #30363d); background: var(--bg-secondary, #161b22);
  color: var(--text-primary, #e6edf3); font-size: var(--fs-md); box-sizing: border-box;
}
.pb-textarea { min-height: 60px; resize: vertical; }
.pb-dialog__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

.pb-tpl-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.pb-tpl-card {
  padding: 12px; border-radius: var(--radius-mid); border: 1px solid var(--border, #30363d);
  background: var(--bg-secondary, #161b22);
  cursor: pointer; transition: border-color 0.15s;
}
.pb-tpl-card:hover { border-color: var(--primary, #58a6ff); }
.pb-tpl-card__icon { font-size: 24px; margin-bottom: 6px; }
.pb-tpl-card h4 { margin: 0 0 4px; font-size: var(--fs-base); }
.pb-tpl-card p { margin: 0 0 6px; font-size: var(--fs-sm); opacity: 0.6; line-height: 1.3; }
.pb-tpl-card__steps { font-size: var(--fs-xs); opacity: 0.5; }
</style>
