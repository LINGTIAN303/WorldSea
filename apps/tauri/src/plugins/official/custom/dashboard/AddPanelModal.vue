<template>
  <div v-if="show" class="modal-overlay" @click.self="$emit('close')">
    <div ref="dialogRef" class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="apm-title" tabindex="-1">
      <h3 id="apm-title">选择面板视图</h3>
      <div class="cv-picker-list">
        <button
          v-for="view in views"
          :key="view.id"
          class="view-pick-btn"
          :class="{ 'vp-selected': selected.has(view.id) }"
          @click="toggleSelect(view)"
        >
          <span class="vp-check">
            <WsIcon :name="selected.has(view.id) ? 'check' : 'checkbox-empty'" size="xs" />
          </span>
          <span class="vp-icon"><WsIcon :name="view.icon" size="sm" :fallback="view.icon" /></span>
          <span class="vp-label">{{ view.label }}</span>
        </button>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" @click="$emit('close')">取消</button>
        <CreateButton
          :label="`添加 (${selected.size})`"
          :disabled="selected.size === 0"
          @click="onConfirm"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 添加面板模态框
 * - 展示当前可添加的视图列表（已存在于面板中的视图会被过滤掉）
 * - 支持多选并批量添加
 */
import { reactive, watch, ref, nextTick } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { CreateButton } from '@worldsmith/plugin-sdk'
import { useFocusTrap } from '@/composables/useFocusTrap'

/** 可选视图项的数据形状 */
interface ViewOption {
  id: string
  icon: string
  label: string
}

const props = defineProps<{
  show: boolean
  views: ViewOption[]
}>()

const emit = defineEmits<{
  close: []
  confirm: [viewIds: string[]]
}>()

const dialogRef = ref<HTMLElement | null>(null)

const { activate, deactivate } = useFocusTrap(dialogRef, {
  escapeDeactivates: true,
  onEscape: () => emit('close'),
})

watch(() => props.show, (v) => {
  if (v) nextTick(() => activate())
  else deactivate()
})

const selected = reactive(new Set<string>())

// 模态框每次打开时清空选中状态，与原实现 handleAddPanel 中 clear 行为一致
watch(() => props.show, (val) => {
  if (val) selected.clear()
})

function toggleSelect(view: ViewOption) {
  if (selected.has(view.id)) {
    selected.delete(view.id)
  } else {
    selected.add(view.id)
  }
}

function onConfirm() {
  emit('confirm', Array.from(selected))
  selected.clear()
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-sticky);
}

.modal-sm {
  background: var(--modal-bg);
  border-radius: var(--radius-2xl);
  padding: 20px;
  max-width: 360px;
  width: 90%;
  display: flex;
  flex-direction: column;
  max-height: 85vh;
}

.modal-sm h3 {
  margin: 0 0 12px;
  font-size: var(--font-size-lg);
  flex-shrink: 0;
}

.cv-picker-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 60vh;
  overflow-y: auto;
  min-height: 0;
  flex: 1;
  padding-right: 4px;
}

.view-pick-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  background: var(--card-bg);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-base);
  color: var(--text-color);
  flex-shrink: 0;
}

.view-pick-btn:hover {
  background: var(--active-bg);
  border-color: var(--primary);
}

.vp-icon {
  font-size: var(--font-size-xl);
}

.vp-label {
  font-weight: var(--font-weight-medium);
}

.modal-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}

.vp-selected {
  border-color: var(--primary) !important;
  background: var(--active-bg) !important;
}

.vp-check {
  font-size: var(--font-size-base);
  width: 18px;
  text-align: center;
  flex-shrink: 0;
  color: var(--primary);
}
</style>
