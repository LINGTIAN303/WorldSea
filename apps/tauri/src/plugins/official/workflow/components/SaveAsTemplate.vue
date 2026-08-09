<template>
  <div class="st-overlay" @click.self="$emit('close')">
    <div class="st-dialog">
      <h3 class="st-title">保存为模板</h3>
      <p class="st-hint">将当前创作计划保存为模板，以便在其他项目中复用</p>

      <div class="st-field">
        <label>模板名称</label>
        <input v-model="form.name" class="st-input" placeholder="例如：中世纪王国创作流程" />
      </div>
      <div class="st-field">
        <label>描述</label>
        <textarea v-model="form.description" class="st-input st-textarea" placeholder="模板用途说明..." />
      </div>
      <div class="st-field st-field--row">
        <label>图标</label>
        <input v-model="form.icon" class="st-input st-input--short" placeholder="📋" maxlength="4" />
      </div>
      <div class="st-field">
        <label>标签（逗号分隔）</label>
        <input v-model="form.tagsInput" class="st-input" placeholder="例如：王国, 中世纪, 完整设定" />
      </div>

      <div class="st-info">
        <span>包含 {{ stepCount }} 个步骤</span>
      </div>

      <div class="st-actions">
        <button class="st-btn" @click="$emit('close')">取消</button>
        <button
          class="st-btn st-btn--primary"
          :disabled="!form.name.trim()"
          @click="handleSave"
        >
          保存模板
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import type { CreationPipeline } from '../types'

const props = defineProps<{
  pipeline: CreationPipeline
}>()

const emit = defineEmits<{
  close: []
  save: [params: {
    name: string
    description?: string
    icon?: string
    tags?: string[]
    steps: any[]
    connections: any[]
  }]
}>()

const form = reactive({
  name: props.pipeline.name + ' (模板)',
  description: props.pipeline.description || '',
  icon: '📋',
  tagsInput: props.pipeline.tags.join(', '),
})

const stepCount = computed(() => props.pipeline.steps.length)

function handleSave() {
  const tags = form.tagsInput
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)

  emit('save', {
    name: form.name.trim(),
    description: form.description.trim(),
    icon: form.icon.trim() || '📋',
    tags,
    steps: props.pipeline.steps as any[],
    connections: props.pipeline.connections as any[],
  })
}
</script>

<style scoped>
.st-overlay {
  position: fixed; inset: 0; background: var(--overlay);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.st-dialog {
  background: var(--bg-primary, #ffffff); border: 1px solid var(--border, #e4e4e7);
  border-radius: var(--radius-2xl); padding: 24px; min-width: 400px; max-width: 480px;
}
.st-title { margin: 0 0 4px; font-size: var(--fs-lg); font-weight: 600; }
.st-hint { margin: 0 0 16px; font-size: var(--fs-sm); opacity: 0.5; }
.st-field { margin-bottom: 12px; }
.st-field label { display: block; font-size: var(--fs-md); margin-bottom: 4px; opacity: 0.7; }
.st-field--row { display: flex; align-items: center; gap: 12px; }
.st-field--row label { margin-bottom: 0; }
.st-input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--border, #e4e4e7); background: var(--bg-secondary, #f4f4f5);
  color: var(--text-primary, #18181b); font-size: var(--fs-md); box-sizing: border-box;
}
.st-input--short { width: 60px; text-align: center; font-size: var(--fs-xl); }
.st-textarea { min-height: 60px; resize: vertical; }

.st-info { margin-bottom: 16px; font-size: var(--fs-sm); opacity: 0.5; }

.st-actions { display: flex; justify-content: flex-end; gap: 8px; }
.st-btn {
  padding: 6px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border, #e4e4e7);
  background: var(--bg-secondary, #f4f4f5); color: var(--text-primary, #18181b);
  cursor: pointer; font-size: var(--fs-md);
}
.st-btn--primary { background: var(--primary, #4f46e5); color: var(--text-on-primary, #fff); border-color: transparent; }
.st-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
