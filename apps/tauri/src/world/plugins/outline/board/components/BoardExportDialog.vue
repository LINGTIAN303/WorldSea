<template>
  <!--
    大纲导出弹层（BoardExportDialog）
    规格：docs/plans/2026-09-16-大纲白板-编辑器交互规格.md §十「导出」
    · 导出的是**全部大纲节点**（未入板的按默认标题式）—— 布局只提供表现形式偏好，不提供结构
    · 格式：Markdown（管道表）/ Word（真表格）
  -->
  <div class="bed-mask" @pointerdown.self="$emit('close')">
    <div class="bed" role="dialog" aria-label="导出大纲">
      <div class="bed-title">导出大纲</div>
      <div class="bed-desc">
        将导出<strong>全部 {{ nodeCount }} 个节点</strong>，按各容器已配置的表现形式渲染
        （标题层级 / 斜体摘要 / 表格 / 树列表）。未放入画布的节点按默认标题式导出。
      </div>

      <div class="bed-formats" role="radiogroup" aria-label="导出格式">
        <button
          v-for="f in FORMATS"
          :key="f.value"
          class="bed-format"
          type="button"
          role="radio"
          :aria-checked="format === f.value"
          :class="{ 'bed-format--on': format === f.value }"
          @click="format = f.value"
        >
          <span class="bed-format-label">{{ f.label }}</span>
          <span class="bed-format-hint">{{ f.hint }}</span>
        </button>
      </div>

      <div class="bed-actions">
        <button class="bed-btn" type="button" :disabled="exporting" @click="$emit('close')">取消</button>
        <button class="bed-btn bed-btn--primary" type="button" :disabled="exporting" @click="onConfirm">
          <WsInlineLoading v-if="exporting" size="sm" label="正在导出大纲" />
          {{ exporting ? '导出中' : '导出' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 导出弹层：只负责收集格式选择并上报，**不做导出逻辑**（在 BoardView → exportRunner）。
 */
import { ref } from 'vue'
import { WsInlineLoading } from '@worldsea/ui-kit'
import type { ExportFormat } from '../export/exportRunner'

defineProps<{
  nodeCount: number
  /** 导出进行中（docx 需动态加载库，可能数百毫秒） */
  exporting?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', format: ExportFormat): void
}>()

const format = ref<ExportFormat>('md')

const FORMATS: Array<{ value: ExportFormat; label: string; hint: string }> = [
  { value: 'md', label: 'Markdown', hint: '标题层级 + 斜体摘要 + 管道表 + 嵌套列表' },
  { value: 'docx', label: 'Word', hint: '标题层级 + 斜体段落 + 真表格（表头恒含）' },
]

function onConfirm(): void {
  emit('confirm', format.value)
}
</script>

<style scoped>
.bed-mask {
  position: absolute;
  inset: 0;
  z-index: 22;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
}
.bed {
  width: 380px;
  max-width: calc(100% - 32px);
  padding: 14px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  background: var(--menubar-bg, var(--bg-secondary));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}
.bed-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-color);
  margin-bottom: 6px;
}
.bed-desc { font-size: var(--font-size-xs); color: var(--text-secondary); line-height: 1.5; margin-bottom: 12px; }
.bed-formats { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.bed-format {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.bed-format:hover { background: var(--hover-bg); }
.bed-format--on { border-color: var(--primary); background: var(--hover-bg); }
.bed-format-label { font-size: var(--font-size-xs); color: var(--text-color); }
.bed-format--on .bed-format-label { color: var(--primary); font-weight: var(--font-weight-medium); }
.bed-format-hint { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.bed-actions { display: flex; justify-content: flex-end; gap: 8px; }
.bed-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  background: transparent;
  /* 按钮文字必须显式设色，否则暗色主题回落到默认黑 */
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.bed-btn:hover:not(:disabled) { background: var(--hover-bg); border-color: var(--primary); color: var(--primary); }
.bed-btn:disabled { opacity: 0.6; cursor: default; }
.bed-btn--primary { color: var(--primary); border-color: var(--primary); }
</style>
