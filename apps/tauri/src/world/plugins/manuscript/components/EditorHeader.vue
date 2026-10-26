<template>
  <div class="ms-editor-header">
    <input
      ref="titleInputRef"
      :value="title"
      class="ms-title-input"
      placeholder="章节标题"
      @input="onTitleInput"
      @blur="$emit('save-title')"
    />
    <div class="ms-header-actions">
      <CustomDropdown :model-value="status" :options="statusOptions" @update:model-value="$emit('status-change', $event)" />
      <button class="ms-action-btn" title="快照" aria-label="保存快照" @click="$emit('snapshot')"><WsIcon name="image" size="sm" /></button>
      <button class="ms-action-btn" :class="{ active: showHistory }" title="历史" aria-label="历史快照" @click="$emit('toggle-history')"><WsIcon name="timeline" size="sm" /></button>
      <button class="ms-action-btn" title="手机预览" aria-label="手机预览" @click="$emit('preview')"><WsIcon name="smartphone" size="sm" /></button>
      <button class="ms-action-btn" title="导出" aria-label="导出" @click="$emit('export')"><WsIcon name="download" size="sm" /></button>
      <span class="ms-header-divider"></span>
      <button ref="statsBtnRef" class="ms-action-btn" :class="{ active: showStats }" title="写作统计" aria-label="写作统计" @click="showStats = !showStats"><WsIcon name="chart" size="sm" /></button>
      <button ref="typoBtnRef" class="ms-action-btn ms-action-btn--aa" :class="{ active: showTypography }" title="排版偏好" aria-label="排版偏好" @click="showTypography = !showTypography">Aa</button>
      <button class="ms-action-btn" :class="{ active: msFocusMode }" title="专注模式（Esc 退出）" aria-label="专注模式" @click="msFocusMode = !msFocusMode"><WsIcon name="eye" size="sm" /></button>
    </div>

    <TypographyPanel
      v-if="showTypography"
      :anchor="typoBtnRef"
      :editor="editor"
      @close="showTypography = false"
    />
    <WritingStatsPanel
      v-if="showStats"
      :book-id="bookId"
      :anchor="statsBtnRef"
      @close="showStats = false"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 编辑器头部（批1 从 ManuscriptView 抽出）：标题输入 + 状态下拉 + 动作按钮组。
 * 在原快照/历史/预览/导出之上新增：统计（WritingStatsPanel）、排版偏好（TypographyPanel）、
 * 专注模式开关（settingsStore 持久化，Esc 退出在 ManuscriptView 视图层处理）。
 * 图标语义顺手校正：历史 manuscript→timeline、导出 item→download。
 */
import { ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { CustomDropdown } from '@worldsea/plugin-sdk'
import { WsIcon } from '@worldsea/ui-kit'
import { msFocusMode } from '../composables/useWritingPrefs'
import TypographyPanel from './TypographyPanel.vue'
import WritingStatsPanel from './WritingStatsPanel.vue'

defineProps<{
  title: string
  status: string
  showHistory: boolean
  bookId: string
  editor: Editor | null
}>()

const emit = defineEmits<{
  'update:title': [value: string]
  'save-title': []
  'status-change': [value: string]
  snapshot: []
  'toggle-history': []
  preview: []
  export: []
}>()

const statusOptions = [
  { value: '草稿', label: '草稿' },
  { value: '修订中', label: '修订中' },
  { value: '终稿', label: '终稿' },
]

const titleInputRef = ref<HTMLInputElement | null>(null)
const statsBtnRef = ref<HTMLElement | null>(null)
const typoBtnRef = ref<HTMLElement | null>(null)
const showStats = ref(false)
const showTypography = ref(false)

function onTitleInput(e: Event) {
  emit('update:title', (e.target as HTMLInputElement).value)
}

/** 新建章节：光标定位到标题行并全选（ManuscriptView.select focusTitle 经此触达） */
function focusTitle() {
  titleInputRef.value?.focus()
  titleInputRef.value?.select()
}

defineExpose({ focusTitle })
</script>

<style scoped>
.ms-editor-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-light);
  background: var(--card-bg);
  flex-shrink: 0;
}
.ms-title-input {
  flex: 1;
  padding: 6px 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-color);
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.ms-title-input:focus { border-bottom-color: var(--primary); }
.ms-header-actions {
  display: flex; align-items: center; gap: 4px; flex-shrink: 0;
}
.ms-header-divider { width: 1px; height: 18px; background: var(--border-light); margin: 0 2px; }
.ms-action-btn {
  width: 32px; height: 32px; border: none; background: transparent;
  cursor: pointer; border-radius: var(--radius-sm);
  /* 图标走 currentColor：此处必须显式设色，否则继承 body 默认黑——暗色主题下不反色（2026-09-15 修复） */
  color: var(--text-secondary);
  display: flex; align-items: center; justify-content: center;
  transition: background 0.12s, color 0.12s;
}
.ms-action-btn:hover { background: var(--hover-bg); color: var(--primary); }
.ms-action-btn.active { background: var(--primary-light); color: var(--primary); }
.ms-action-btn--aa { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); font-family: var(--font-family-editor-ui); }
</style>
